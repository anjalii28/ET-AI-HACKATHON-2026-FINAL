import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('review_insights')
export class ReviewInsight {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  place_id: string;

  @Column({ type: 'jsonb' })
  sentiment_summary: {
    positive: number;
    neutral: number;
    negative: number;
  };

  @Column({ type: 'jsonb' })
  top_positive_themes: string[];

  @Column({ type: 'jsonb' })
  top_complaints: string[];

  @Column({ type: 'jsonb' })
  risk_keywords: string[];

  @Column({ type: 'text', nullable: true })
  executive_summary: string;

  @Column({ type: 'jsonb', nullable: true })
  improvement_opportunities: string[];

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  updated_at: Date;
}
