import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('external_reviews')
export class ExternalReview {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  place_id: string;

  @Column({ type: 'varchar', length: 255 })
  author_name: string;

  @Column({ type: 'integer' })
  rating: number;

  @Column({ type: 'text' })
  review_text: string;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'bigint', nullable: true })
  review_time: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  sentiment_label: string;

  @Column({ type: 'varchar', length: 50, default: 'google_places_api' })
  source: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  author_email: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'timestamp', nullable: true })
  scraped_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}
