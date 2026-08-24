import { createHash } from "node:crypto";

export const JUDGE_MODEL = "gemini-2.5-flash-lite";
export const JUDGE_PROMPT_VERSION = "robot-success-v1";

export function judgePrompt(instruction) {
  return `You are a blinded evaluator of one real robot-policy rollout.

Task instruction: ${instruction}

Watch the entire video and decide whether the robot visibly completed the requested task by the end.

Use SUCCESS only when the requested end state is visibly achieved. Use FAILURE when the robot only attempts the task, makes partial progress, performs the wrong action, undoes the result, times out, or completion is not visible. Do not infer success from motion alone. Judge only this video and instruction; do not guess the policy identity.

Return the required JSON fields. confidence is confidence in the binary verdict from 0 to 1. partial_success is achieved task progress from 0 to 1. evidence must be a concise visual observation without mentioning any policy name.`;
}

export function promptHash() {
  return createHash("sha256").update(judgePrompt("<TASK_INSTRUCTION>"), "utf8").digest("hex");
}

export const JUDGE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["SUCCESS", "FAILURE"],
      description: "Binary task-completion verdict.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence in the binary verdict.",
    },
    partial_success: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Visible fraction of the requested task completed.",
    },
    reason_code: {
      type: "string",
      enum: ["COMPLETE", "NO_PROGRESS", "PARTIAL", "WRONG_ACTION", "NOT_VISIBLE", "ABORTED"],
    },
    evidence: {
      type: "string",
      description: "A concise visual observation supporting the verdict.",
    },
  },
  required: ["verdict", "confidence", "partial_success", "reason_code", "evidence"],
};

