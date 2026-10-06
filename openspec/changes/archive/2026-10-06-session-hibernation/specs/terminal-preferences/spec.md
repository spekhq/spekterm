## ADDED Requirements

### Requirement: Preferences include automatic hibernation

The preferences SHALL include whether idle sessions hibernate automatically and after how long (see
`session-hibernation`). The default SHALL be **enabled, after 24 hours**.

The Settings interface SHALL offer this as a single choice among: off, 4 hours, 24 hours, 3 days, and 7 days.
A change SHALL take effect without restarting the application.

The persisted value SHALL accept any whole number of seconds, not only the offered choices, with zero meaning
off; a value that is missing, negative, not a whole number, or unreadable SHALL fall back to the default
without affecting the other preferences (the existing corruption-resilience rule of this capability). Turning
it off SHALL be persisted as off, not as a missing value — a missing value means the default, which is on. A
stored value that is not one of the offered choices SHALL be shown as that value, not replaced by the nearest
choice.

**Why any value is accepted**: acceptance needs a threshold of seconds, and a value written into the
preferences is data the product already reads — not a branch the product carries for tests.

#### Scenario: Default is 24 hours

- **WHEN** the preferences contain no automatic-hibernation value and the user opens Settings
- **THEN** automatic hibernation is shown as enabled after 24 hours

#### Scenario: Turning it off persists

- **WHEN** the user turns automatic hibernation off, closes the application and reopens it
- **THEN** automatic hibernation is off

#### Scenario: A change applies without restart

- **WHEN** the stored threshold is a few seconds, the user turns automatic hibernation off in Settings, and an
  idle session that is not displayed then passes that threshold
- **THEN** it is still running, and the application was not restarted

#### Scenario: A value outside the choices is shown as itself

- **WHEN** the stored threshold is not one of the offered choices and the user opens Settings
- **THEN** Settings shows that threshold, not one of the offered choices

#### Scenario: An invalid value falls back to the default

- **WHEN** the persisted automatic-hibernation value is negative or not a number
- **THEN** automatic hibernation is enabled after 24 hours, and the other preferences are unaffected
