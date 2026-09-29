import { describe, it, expect } from 'vitest';
import { FindingSchema, FindingsOutputSchema } from '../src/schema/finding.schema.js';

const validFinding = {
  file: 'src/domain/user.service.ts',
  line: 42,
  severity: 'high' as const,
  category: 'layering' as const,
  title: 'Domain imports infrastructure',
  rationale: 'The domain layer should not depend on infrastructure concerns.',
  confidence: 0.9,
};

describe('FindingSchema', () => {
  it('accepts a valid finding with all required fields', () => {
    const result = FindingSchema.safeParse(validFinding);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.file).toBe(validFinding.file);
      expect(result.data.line).toBe(42);
      expect(result.data.severity).toBe('high');
      expect(result.data.category).toBe('layering');
      expect(result.data.confidence).toBe(0.9);
    }
  });

  it('accepts a valid finding with optional suggestion', () => {
    const withSuggestion = { ...validFinding, suggestion: 'Move this import to application layer.' };
    const result = FindingSchema.safeParse(withSuggestion);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestion).toBe('Move this import to application layer.');
    }
  });

  it('accepts a valid finding without suggestion (suggestion is optional)', () => {
    const result = FindingSchema.safeParse(validFinding);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestion).toBeUndefined();
    }
  });

  it('rejects when file is missing', () => {
    const { file: _file, ...withoutFile } = validFinding;
    const result = FindingSchema.safeParse(withoutFile);
    expect(result.success).toBe(false);
  });

  it('rejects when line is missing', () => {
    const { line: _line, ...withoutLine } = validFinding;
    const result = FindingSchema.safeParse(withoutLine);
    expect(result.success).toBe(false);
  });

  it('rejects when severity is missing', () => {
    const { severity: _severity, ...withoutSeverity } = validFinding;
    const result = FindingSchema.safeParse(withoutSeverity);
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity value', () => {
    const withBadSeverity = { ...validFinding, severity: 'critical' };
    const result = FindingSchema.safeParse(withBadSeverity);
    expect(result.success).toBe(false);
  });

  it('rejects invalid category value', () => {
    const withBadCategory = { ...validFinding, category: 'style' };
    const result = FindingSchema.safeParse(withBadCategory);
    expect(result.success).toBe(false);
  });

  it('rejects confidence below 0', () => {
    const withBadConfidence = { ...validFinding, confidence: -0.1 };
    const result = FindingSchema.safeParse(withBadConfidence);
    expect(result.success).toBe(false);
  });

  it('rejects confidence above 1', () => {
    const withBadConfidence = { ...validFinding, confidence: 1.1 };
    const result = FindingSchema.safeParse(withBadConfidence);
    expect(result.success).toBe(false);
  });

  it('accepts confidence at boundary values 0 and 1', () => {
    const atZero = { ...validFinding, confidence: 0 };
    const atOne = { ...validFinding, confidence: 1 };
    expect(FindingSchema.safeParse(atZero).success).toBe(true);
    expect(FindingSchema.safeParse(atOne).success).toBe(true);
  });

  it('rejects line number that is not a positive integer', () => {
    const withZeroLine = { ...validFinding, line: 0 };
    expect(FindingSchema.safeParse(withZeroLine).success).toBe(false);

    const withNegLine = { ...validFinding, line: -1 };
    expect(FindingSchema.safeParse(withNegLine).success).toBe(false);
  });

  it('rejects title exceeding 200 characters', () => {
    const withLongTitle = { ...validFinding, title: 'x'.repeat(201) };
    const result = FindingSchema.safeParse(withLongTitle);
    expect(result.success).toBe(false);
  });

  it('rejects rationale exceeding 1000 characters', () => {
    const withLongRationale = { ...validFinding, rationale: 'x'.repeat(1001) };
    const result = FindingSchema.safeParse(withLongRationale);
    expect(result.success).toBe(false);
  });
});

describe('FindingsOutputSchema', () => {
  it('accepts empty findings array', () => {
    const result = FindingsOutputSchema.safeParse({ findings: [] });
    expect(result.success).toBe(true);
  });

  it('accepts array with valid findings', () => {
    const result = FindingsOutputSchema.safeParse({ findings: [validFinding] });
    expect(result.success).toBe(true);
  });

  it('rejects when findings key is missing', () => {
    const result = FindingsOutputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
