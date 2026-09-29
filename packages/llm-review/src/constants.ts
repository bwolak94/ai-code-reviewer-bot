/**
 * NestJS injection token for the LLMProvider implementation.
 * Defined in a separate file to avoid circular imports between
 * the module and the router.
 */
export const LLM_PROVIDER = 'LLM_PROVIDER';
