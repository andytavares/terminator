# BDD spec style

Given / When / Then. One behavior per scenario. No incidental detail.

```gherkin
Feature: Account lockout

  Scenario: Five failed logins lock the account
    Given a user with 4 prior failed login attempts in the last hour
    When the user submits an incorrect password
    Then the account is locked
    And a lockout notification email is queued
```

Avoid: UI selectors, HTTP status codes in scenario text, technical jargon. Keep it in the user's language.
