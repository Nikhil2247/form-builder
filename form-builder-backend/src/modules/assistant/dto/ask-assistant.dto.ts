import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AskAssistantDto {
  @IsString()
  @MinLength(1, { message: 'message cannot be empty' })
  @MaxLength(4000)
  message!: string;

  /** Continue an existing session. Omit to start a new one. */
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  /** The form the user currently has open, if any — lets explain_rule/propose_rule work without asking for a formId. */
  @IsOptional()
  @IsUUID()
  currentFormId?: string;

  /**
   * A short UI-only nudge from the frontend's mode toggler (e.g. "the user
   * selected Insights mode") — appended to the user turn, never used to
   * change which tools or system prompt are sent. See
   * AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.6.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  modeHint?: string;
}
