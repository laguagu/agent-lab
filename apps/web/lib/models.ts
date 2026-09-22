/**
 * Models the container can run, and which track runs each one.
 *
 * The claude-container runner speaks the Anthropic Messages format. Claude models
 * therefore reach their provider directly, while everything else has to pass through the
 * LiteLLM gateway, which translates the format. That is why each entry declares
 * `viaGateway`: the picker disables those options when the gateway is not running,
 * instead of letting a request fail somewhere the user cannot see it.
 *
 * The `id` of a gateway model is a LiteLLM `model_name` alias from
 * `infra/litellm/config.yaml`, not a provider model id.
 *
 * Codex entries need no gateway: the codex-container track speaks OpenAI natively. Their
 * `id` is a Codex model slug.
 */

import type { ContainerRunner } from "@agent-lab/protocol";

export type Provider = "anthropic" | "openai" | "google" | "azure";

export type ModelOption = {
  id: string;
  label: string;
  provider: Provider;
  /** Requires the LiteLLM gateway to be up. */
  viaGateway: boolean;
  /** The track that runs this model. Defaults to claude-container. */
  runner?: ContainerRunner;
  note?: string;
};

export const PROVIDER_LOGO: Record<Provider, string> = {
  anthropic: "/logos/anthropic.svg",
  openai: "/logos/openai.svg",
  google: "/logos/google.svg",
  azure: "/logos/azure.svg",
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  azure: "Azure",
};

export const MODELS: ModelOption[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    provider: "anthropic",
    viaGateway: false,
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
    provider: "anthropic",
    viaGateway: false,
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    provider: "anthropic",
    viaGateway: false,
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    provider: "openai",
    viaGateway: false,
    runner: "codex-container",
    note: "Codex CLI in the container",
  },
  {
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    provider: "openai",
    viaGateway: false,
    runner: "codex-container",
    note: "Codex CLI in the container",
  },
  {
    id: "gpt-azure",
    label: "GPT",
    provider: "azure",
    viaGateway: true,
    note: "Azure OpenAI deployment",
  },
  {
    id: "gpt",
    label: "GPT",
    provider: "openai",
    viaGateway: true,
  },
  {
    id: "gemini",
    label: "Gemini",
    provider: "google",
    viaGateway: true,
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

export function findModel(id: string): ModelOption | undefined {
  return MODELS.find((m) => m.id === id);
}

export function runnerOf(id: string): ContainerRunner {
  return findModel(id)?.runner ?? "claude-container";
}
