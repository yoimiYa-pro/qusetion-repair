/** JSON Schema (draft-07) for LLM output → Markdown pipeline */
export const mistakeBatchSchema = {
  $id: "https://qusetion-repair.local/schema/mistake-batch.json",
  title: "MistakeNoteBatch",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/definitions/mistakeItem" },
    },
    batch_title: {
      type: "string",
      description: "Optional title for the whole batch / file",
    },
  },
  definitions: {
    mistakeItem: {
      type: "object",
      additionalProperties: false,
      required: ["title", "stem", "analysis", "topic_tags"],
      properties: {
        title: { type: "string", minLength: 1 },
        subject: { type: "string" },
        topic_tags: {
          type: "array",
          items: { type: "string" },
        },
        stem: { type: "string", minLength: 1 },
        options: {
          type: "array",
          items: { type: "string" },
        },
        user_answer: { type: "string" },
        correct_answer: { type: "string" },
        analysis: { type: "string", minLength: 1 },
        formulas: {
          type: "array",
          items: { type: "string" },
        },
        source_hint: { type: "string" },
        difficulty: {
          type: "string",
          enum: ["easy", "medium", "hard", "unknown"],
        },
        status: {
          type: "string",
          enum: ["draft", "reviewed", "archived"],
        },
      },
    },
  },
} as const;
