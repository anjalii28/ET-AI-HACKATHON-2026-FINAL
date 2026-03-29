import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ExternalReview } from './entities/external-review.entity';

/** Review payload for creating a ticket; may include action fields from JSON (e.g. reviews_analysis.json). */
export type ReviewForTicket = ExternalReview & {
  action_required?: string | null;
  action_description?: string | null;
};

interface ChatwootContact {
  id: number;
  source_id: string;
}

@Injectable()
export class ChatwootService {
  private readonly logger = new Logger(ChatwootService.name);
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly accountId: string;
  private readonly reviewsInboxId: string;
  private readonly http: AxiosInstance;
  private inboxNumericId: number | null = null;
  private inboxIdentifier: string | null = null;

  constructor() {
    this.apiUrl =
      process.env.CHATWOOT_API_URL || 'https://app.chatwoot.com/api/v1';
    this.apiToken = process.env.CHATWOOT_API_TOKEN || '';
    this.accountId = process.env.CHATWOOT_ACCOUNT_ID || '';
    // Dedicated inbox for Reviews channel (can be numeric ID or inbox identifier). No fallback to generic inbox.
    this.reviewsInboxId = process.env.CHATWOOT_REVIEWS_INBOX_ID || '';

    if (!this.apiToken || !this.accountId || !this.reviewsInboxId) {
      this.logger.warn(
        'Chatwoot not fully configured (CHATWOOT_API_TOKEN, CHATWOOT_ACCOUNT_ID, CHATWOOT_REVIEWS_INBOX_ID). Review tickets will be skipped.',
      );
    } else {
      const sourceEnv = 'CHATWOOT_REVIEWS_INBOX_ID';
      if (/^\d+$/.test(this.reviewsInboxId)) {
        this.inboxNumericId = Number(this.reviewsInboxId);
        this.logger.log(
          `Chatwoot Reviews inbox id=${this.inboxNumericId} from ${sourceEnv}.`,
        );
      } else {
        this.inboxIdentifier = this.reviewsInboxId;
        this.logger.log(
          `Chatwoot Reviews inbox identifier="${this.inboxIdentifier}" from ${sourceEnv}; will resolve numeric id via API.`,
        );
      }
    }

    this.http = axios.create({
      baseURL: this.apiUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        api_access_token: this.apiToken,
      },
    });
  }

  private isConfigured(): boolean {
    return !!(this.apiToken && this.accountId && this.reviewsInboxId);
  }

  /**
   * Debug: resolve Reviews inbox and return inbox list for troubleshooting.
   */
  async getReviewsInboxDebug(): Promise<{
    configured: boolean;
    reviewsInboxId: string;
    resolvedInboxId: number | null;
    inboxes: Array<{ id: number; name: string; identifier?: string; channelId?: string }>;
    error?: string;
  }> {
    const result: {
      configured: boolean;
      reviewsInboxId: string;
      resolvedInboxId: number | null;
      inboxes: Array<{ id: number; name: string; identifier?: string; channelId?: string }>;
      error?: string;
    } = {
      configured: this.isConfigured(),
      reviewsInboxId: this.reviewsInboxId,
      resolvedInboxId: this.inboxNumericId,
      inboxes: [] as Array<{ id: number; name: string; identifier?: string; channelId?: string }>,
    };
    if (!this.apiToken || !this.accountId) return result;
    try {
      const res = await this.http.get(`/accounts/${this.accountId}/inboxes`);
      const data = res.data;
      const inboxes: any[] = Array.isArray(data?.payload) ? data.payload : Array.isArray(data) ? data : [];
      result.inboxes = inboxes.slice(0, 20).map((ib: any) => ({
        id: ib.id,
        name: ib.name ?? '—',
        identifier: ib.identifier ?? ib.inbox_identifier,
        channelId: ib.channel?.identifier ?? ib.channel?.inbox_identifier,
      }));
      const resolved = await this.getInboxId();
      result.resolvedInboxId = resolved;
      return result;
    } catch (err) {
      const e = err as Error;
      result.error = e.message;
      return result;
    }
  }

  /**
   * Public entrypoint: create a Chatwoot ticket for a single negative review.
   * Mirrors the Call Intelligence ticket flow: Action Required, Next Step, Suggested Team from JSON.
   */
  async createReviewTicket(review: ReviewForTicket): Promise<void> {
    if (!this.isConfigured()) return;

    try {
      const exists = await this.reviewTicketExists(review);
      if (exists) {
        return;
      }

      const contact = await this.ensureContact(review);
      if (!contact) {
        return;
      }

      const conversation = await this.createConversation(
        contact.id,
        contact.source_id,
      );
      if (!conversation?.id) {
        return;
      }

      const conversationId = conversation.id as number;

      const messageBody = this.buildMessageBody(review);
      if (messageBody) {
        await this.addMessage(conversationId, messageBody);
      }

      const labels = this.buildLabels(review);
      if (labels.length) {
        await this.addLabels(conversationId, labels);
      }

      const customAttrs: Record<string, unknown> = {
        review_id: review.id,
        review_place_id: review.place_id,
        review_rating: review.rating,
        review_source: review.source,
        review_department: review.department || null,
      };
      if (review.action_required != null) {
        customAttrs.action_required = String(review.action_required);
      }
      if (review.action_description != null) {
        customAttrs.action_description = String(review.action_description);
      }
      if (review.department != null) {
        customAttrs.suggested_team = String(review.department);
      }
      await this.addCustomAttributes(conversationId, customAttrs);

      const internalNote = this.buildInternalNote(review);
      if (internalNote) {
        await this.addPrivateNote(conversationId, internalNote);
      }

      this.logger.log(
        `Created Chatwoot review ticket for review id=${review.id}, place_id=${review.place_id}`,
      );
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to create Chatwoot review ticket for review id=${review.id}: ${error.message}`,
      );
    }
  }

  /**
   * Check if we already created a ticket for this review in the Reviews inbox.
   * Only skips if a conversation with this review_id exists in the Reviews inbox (not in other inboxes).
   */
  private async reviewTicketExists(review: ExternalReview): Promise<boolean> {
    const inboxId = await this.getInboxId();
    if (!inboxId) return false;

    try {
      const payload = {
        payload: [
          {
            attribute_key: 'custom_attribute_review_id',
            filter_operator: 'equal_to',
            values: [String(review.id)],
            query_operator: null,
          },
          {
            attribute_key: 'inbox_id',
            filter_operator: 'equal_to',
            values: [String(inboxId)],
            query_operator: 'and',
          },
        ],
      };

      const res = await this.http.post(
        `/accounts/${this.accountId}/conversations/filter`,
        payload,
        { params: { page: 1 } },
      );

      const data = res.data;
      let conversations: unknown[] = [];
      if (data?.data?.payload && Array.isArray(data.data.payload)) {
        conversations = data.data.payload;
      } else if (Array.isArray(data?.payload)) {
        conversations = data.payload;
      } else if (Array.isArray(data?.data)) {
        conversations = data.data;
      }
      return conversations.length > 0;
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Could not check existing Chatwoot ticket for review id=${review.id}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Create or reuse a Chatwoot contact for this review.
   * Uses a deterministic identifier derived from review id.
   */
  private async ensureContact(review: ExternalReview): Promise<ChatwootContact | null> {
    const identifier = `review-${review.place_id}-${review.id}`;
    const name = review.author_name || 'Review Customer';

    try {
      // Try to find existing contact by identifier
      const searchRes = await this.http.get(
        `/accounts/${this.accountId}/contacts/search`,
        { params: { q: identifier } },
      );
      const existing = Array.isArray(searchRes.data)
        ? searchRes.data[0]
        : Array.isArray(searchRes.data?.payload)
        ? searchRes.data.payload[0]
        : null;
      if (existing?.id) {
        return {
          id: existing.id,
          source_id:
            existing.source_id || existing.identifier || identifier,
        };
      }
    } catch {
      // Non-fatal — fall through to create contact
    }

    const contactData: Record<string, unknown> = {
      name,
      identifier,
    };
    if (review.author_email) {
      contactData.email = review.author_email;
    }

    try {
      const res = await this.http.post(
        `/accounts/${this.accountId}/contacts`,
        contactData,
      );
      // Chatwoot can return { payload: { contact: { id, identifier, ... } } } or { id, identifier }
      const contact =
        res.data?.payload?.contact ?? res.data?.payload ?? res.data;
      const contactId = contact?.id;
      if (!contactId) {
        this.logger.warn(
          `Contact creation response missing id for review id=${review.id}`,
        );
        return null;
      }
      return {
        id: contactId,
        source_id:
          contact.source_id || contact.identifier || identifier,
      };
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to create Chatwoot contact for review id=${review.id}: ${error.message}`,
      );
      return null;
    }
  }

  private async createConversation(
    contactId: number,
    sourceId: string,
  ): Promise<{ id: number } | null> {
    const inboxId = await this.getInboxId();
    if (!inboxId) {
      this.logger.warn(
        'Cannot create Chatwoot conversation: Reviews inbox ID could not be resolved.',
      );
      return null;
    }

    const conversationData = {
      source_id: sourceId,
      inbox_id: inboxId,
      contact_id: Number(contactId),
    };

    try {
      const res = await this.http.post(
        `/accounts/${this.accountId}/conversations`,
        conversationData,
      );
      // Chatwoot may return conversation at top level or under payload
      const conv = res.data?.payload ?? res.data;
      return conv?.id ? { id: conv.id } : null;
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to create Chatwoot conversation for contact id=${contactId}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Resolve the numeric inbox ID to use for Reviews.
   * Accepts either a numeric ID or an inbox identifier string in env.
   */
  private async getInboxId(): Promise<number | null> {
    if (this.inboxNumericId) return this.inboxNumericId;
    if (!this.apiToken || !this.accountId) return null;

    // If reviewsInboxId looks numeric but was not set earlier, parse now.
    if (this.reviewsInboxId && /^\d+$/.test(this.reviewsInboxId)) {
      this.inboxNumericId = Number(this.reviewsInboxId);
      return this.inboxNumericId;
    }

    if (!this.inboxIdentifier) return null;

    try {
      const res = await this.http.get(
        `/accounts/${this.accountId}/inboxes`,
      );
      const data = res.data;
      const inboxes: any[] = Array.isArray(data?.payload)
        ? data.payload
        : Array.isArray(data)
        ? data
        : [];

      const match = inboxes.find((ibox) => {
        if (!ibox) return false;
        const idVal =
          ibox.identifier ??
          ibox.inbox_identifier ??
          ibox.channel?.identifier ??
          ibox.channel?.inbox_identifier;
        return idVal === this.inboxIdentifier;
      });

      if (!match?.id) {
        this.logger.warn(
          `Could not resolve Chatwoot inbox from identifier="${this.inboxIdentifier}".`,
        );
        return null;
      }

      this.inboxNumericId = Number(match.id);
      this.logger.log(
        `Resolved Reviews inbox identifier "${this.inboxIdentifier}" to id=${this.inboxNumericId}.`,
      );
      return this.inboxNumericId;
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Failed to resolve Chatwoot inbox from identifier="${this.inboxIdentifier}": ${error.message}`,
      );
      return null;
    }
  }

  private async addMessage(
    conversationId: number,
    content: string,
  ): Promise<void> {
    const messageData = {
      content,
      message_type: 'incoming',
    };

    try {
      await this.http.post(
        `/accounts/${this.accountId}/conversations/${conversationId}/messages`,
        messageData,
      );
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Failed to add message for conversation id=${conversationId}: ${error.message}`,
      );
    }
  }

  private async addPrivateNote(
    conversationId: number,
    content: string,
  ): Promise<void> {
    const noteData = {
      content,
      message_type: 'activity',
      private: true,
    };

    try {
      await this.http.post(
        `/accounts/${this.accountId}/conversations/${conversationId}/messages`,
        noteData,
      );
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Failed to add private note for conversation id=${conversationId}: ${error.message}`,
      );
    }
  }

  private async addLabels(
    conversationId: number,
    labels: string[],
  ): Promise<void> {
    if (!labels.length) return;

    const labelData = { labels };

    try {
      await this.http.post(
        `/accounts/${this.accountId}/conversations/${conversationId}/labels`,
        labelData,
      );
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Failed to add labels for conversation id=${conversationId}: ${error.message}`,
      );
    }
  }

  private async addCustomAttributes(
    conversationId: number,
    attributes: Record<string, unknown>,
  ): Promise<void> {
    if (!attributes || Object.keys(attributes).length === 0) return;

    const payload = {
      custom_attributes: attributes,
    };

    try {
      await this.http.post(
        `/accounts/${this.accountId}/conversations/${conversationId}/custom_attributes`,
        payload,
      );
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Failed to add custom attributes for conversation id=${conversationId}: ${error.message}`,
      );
    }
  }

  private buildMessageBody(review: ReviewForTicket): string {
    const lines: string[] = [];
    lines.push(`**Rating:** ${review.rating}/5`);
    lines.push(`**Review:** ${(review.review_text || '').trim() || '—'}`);

    if (review.department?.trim()) {
      lines.push(`**Suggested Team:** ${review.department.trim()}`);
    }

    lines.push(`**Review ID:** ${review.id}`);
    return lines.join('\n');
  }

  /**
   * Build internal note (private) for Reviews.
   * Only shows Next Step and Suggested Team.
   */
  private buildInternalNote(review: ReviewForTicket): string {
    const sections: string[] = [];

    if (review.action_description?.trim()) {
      sections.push(`**Next Step:** ${review.action_description.trim()}`);
    }

    if (review.department?.trim()) {
      sections.push(`**Suggested Team:** ${review.department.trim()}`);
    }

    return sections.length > 0 ? sections.join('\n\n') : '';
  }

  private buildLabels(review: ExternalReview): string[] {
    const labels: string[] = ['review', 'negative_review'];
    if (review.department) {
      const normalized = review.department
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (normalized) {
        labels.push(`department_${normalized}`);
      }
    }
    return labels;
  }
}

