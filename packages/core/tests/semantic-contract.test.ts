import { describe, expect, it } from "vitest";
import {
  buildBaselineSemanticContractCandidate,
  buildSemanticContractForPage
} from "../src/semantic-contract.js";

describe("semantic contract builders", () => {
  it("preserves an explicit page semantic_contract", () => {
    const explicit = {
      fields: [{ key: "email", label: "Email" }],
      actions: [{ key: "submit_login", label: "Submit login" }],
      navigation: [{ target_page_id: "home", label: "Home" }],
      component_keys: ["primary_button"],
      allowed_copy: ["Sign in"]
    };

    expect(
      buildSemanticContractForPage({
        page: {
          page_id: "login",
          name: "Login",
          semantic_contract: explicit,
          semantic_contract_coverage: "explicit",
          copy: [{ text: "Ignored replacement copy" }],
          declared_fields: [{ key: "different", label: "Different" }]
        },
        navigation: [{ from: "login", to: "settings", label: "Settings" }]
      })
    ).toEqual({
      semantic_contract: explicit,
      semantic_contract_coverage: "explicit",
      generated_source: "explicit",
      conflicts: []
    });
  });

  it("derives minimal page contracts only from allowed structured sources", () => {
    const result = buildSemanticContractForPage({
      page: {
        page_id: "login",
        name: "Login",
        baseline_page: "baseline-login",
        features: "mentions password reset",
        fields: "phone number from free text must not become a field",
        interactions: "tap forgot password from free text must not become an action",
        copy: [{ text: "Sign in" }, { text: "Email address" }],
        declared_fields: [{ key: "email", label: "Email address" }],
        declared_actions: [{ key: "submit_login", label: "Submit login" }],
        declared_component_keys: ["primary_button"]
      },
      navigation: [
        { from: "login", to: "home", label: "Home" },
        { from: "home", to: "login", label: "Back to login" }
      ],
      product_rules: [
        {
          id: "rule-1",
          page_id: "login",
          given: "free text given is forbidden",
          when: "free text when is forbidden",
          then: "free text then is forbidden",
          semantic: {
            fields: [{ key: "password", label: "Password" }],
            actions: [{ key: "forgot_password", label: "Forgot password" }],
            component_keys: ["secondary_link"],
            allowed_copy: ["Forgot password?"]
          }
        }
      ],
      baseline_label: "Existing login"
    });

    expect(result).toEqual({
      semantic_contract_coverage: "minimal",
      generated_source: "minimal",
      conflicts: [],
      semantic_contract: {
        fields: [
          { key: "email", label: "Email address" },
          { key: "password", label: "Password" }
        ],
        actions: [
          { key: "submit_login", label: "Submit login" },
          { key: "forgot_password", label: "Forgot password" }
        ],
        navigation: [{ target_page_id: "home", label: "Home" }],
        component_keys: ["primary_button", "secondary_link"],
        allowed_copy: ["Login", "Sign in", "Email address", "Existing login", "Forgot password?"]
      }
    });
  });

  it("excludes free-text baseline fields and interactions from machine contracts", () => {
    const result = buildBaselineSemanticContractCandidate({
      product_id: "P-123abc",
      pages: [
        {
          id: "login",
          name: "Login",
          features: "supports biometric sign in",
          fields: "email, password",
          interactions: "tap sign in",
          copy: [{ text: "Sign in" }],
          source_requirements: ["R-11111111"]
        }
      ],
      navigation: []
    });

    expect(result).toEqual({
      ok: true,
      conflicts: [],
      pages: [
        {
          id: "login",
          semantic_contract_coverage: "minimal",
          semantic_contract: {
            fields: [],
            actions: [],
            navigation: [],
            component_keys: [],
            allowed_copy: ["Login", "Sign in"]
          }
        }
      ]
    });
  });

  it("detects field/action key label conflicts in baseline aggregates", () => {
    const result = buildBaselineSemanticContractCandidate({
      product_id: "P-123abc",
      pages: [
        {
          id: "login",
          name: "Login",
          copy: [],
          source_requirements: ["R-11111111"],
          source_semantic_contracts: [
            {
              source_requirement: "R-11111111",
              page_id: "login-a",
              semantic_contract: {
                fields: [{ key: "email", label: "Email" }],
                actions: [{ key: "submit", label: "Submit" }],
                navigation: [],
                component_keys: [],
                allowed_copy: []
              }
            },
            {
              source_requirement: "R-22222222",
              page_id: "login-b",
              semantic_contract: {
                fields: [{ key: "email", label: "Email address" }],
                actions: [{ key: "submit", label: "Sign in" }],
                navigation: [],
                component_keys: [],
                allowed_copy: []
              }
            }
          ]
        }
      ],
      navigation: []
    });

    expect(result).toMatchObject({
      ok: false,
      code: "BASELINE_SEMANTIC_CONTRACT_CONFLICT",
      conflicts: [
        {
          kind: "field",
          key: "email",
          labels: ["Email", "Email address"]
        },
        {
          kind: "action",
          key: "submit",
          labels: ["Submit", "Sign in"]
        }
      ]
    });
  });
});
