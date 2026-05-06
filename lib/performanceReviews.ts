// Staff Performance Reviews — Manager evaluation logic.
//
// This module provides the classification and validation rules for
// periodic cook evaluations. It follows the project pattern of
// separating business rules (pure functions) from data persistence.

export interface PerformanceReviewInput {
  punctuality_score: number;
  technique_score: number;
  speed_score: number;
}

export type ReviewStatus = 'green' | 'amber' | 'red' | 'gray';

export interface ReviewClassification {
  average_score: number;
  status: ReviewStatus;
  label: string;
}

/**
 * Classify a performance review based on its numeric scores.
 * 
 * Logic:
 * - Green (>= 4.0): Exceptional or Great performance.
 * - Amber (2.5 - 3.9): Solid/Good performance, but areas for growth.
 * - Red (< 2.5): Requires immediate attention or training.
 * - Gray: Invalid or zero scores.
 */
export function classifyReview(input: PerformanceReviewInput): ReviewClassification {
  const scores = [
    input.punctuality_score,
    input.technique_score,
    input.speed_score,
  ].filter((s) => typeof s === 'number' && s > 0);

  if (!scores.length) {
    return { average_score: 0, status: 'gray', label: 'No scores' };
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  
  let status: ReviewStatus = 'amber';
  let label = 'Solid';

  if (avg >= 4) {
    status = 'green';
    label = avg >= 4.5 ? 'Exceptional' : 'Great';
  } else if (avg < 2.5) {
    status = 'red';
    label = 'Needs Improvement';
  } else if (avg >= 3) {
    label = 'Good';
  }

  return { average_score: Number(avg.toFixed(1)), status, label };
}

/**
 * Validate that scores are within the allowed 1-5 range.
 */
export function validateScores(input: PerformanceReviewInput): string | null {
  const scores = [
    { val: input.punctuality_score, name: 'On Time' },
    { val: input.technique_score, name: 'Technique' },
    { val: input.speed_score, name: 'Speed' },
  ];

  for (const s of scores) {
    if (isNaN(s.val) || s.val < 1 || s.val > 5) {
      return `${s.name} score must be between 1 and 5.`;
    }
  }

  return null;
}
