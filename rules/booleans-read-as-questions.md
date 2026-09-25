---
id: booleans-read-as-questions
severity: low
check: judge
model: small
budget: 30s, $0.05
---
Intent: a boolean name reads as a yes/no question, so a condition reads as a sentence.
Rule: every boolean variable, property, parameter and boolean-returning function is named as a question, starting with a verb like `is`, `has`, `should`, `can`, `was` or `needs` (`isValid`, `has_children`, `shouldRetry`). Flag booleans named as nouns or adjectives alone (`valid`, `enabled`, `flag`, `status`). Do not flag names imposed by an external API or schema.
