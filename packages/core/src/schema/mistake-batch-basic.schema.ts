/** 基础模式：仅抽取题干与选项，不要求解析等字段（省 token） */
export const mistakeBatchBasicSchema = {
  $id: "https://qusetion-repair.local/schema/mistake-batch-basic.json",
  title: "MistakeNoteBatchBasic",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/definitions/mistakeItemBasic" },
    },
    batch_title: {
      type: "string",
      description: "Optional title for the whole batch / file",
    },
  },
  definitions: {
    mistakeItemBasic: {
      type: "object",
      additionalProperties: false,
      required: ["title", "stem", "topic_tags"],
      properties: {
        title: { type: "string", minLength: 1 },
        stem: { type: "string", minLength: 1 },
        topic_tags: {
          type: "array",
          items: { type: "string" },
        },
        options: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
} as const;
