import { z } from "zod";

export const semanticContractItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1)
}).strict();

export const semanticContractSchema = z.object({
  fields: z.array(semanticContractItemSchema),
  actions: z.array(semanticContractItemSchema),
  navigation: z.array(z.object({
    target_page_id: z.string().min(1),
    label: z.string().optional()
  }).strict()),
  component_keys: z.array(z.string().min(1)),
  allowed_copy: z.array(z.string())
}).strict();

export const semanticContractCoverageSchema = z.enum(["explicit", "minimal"]);
