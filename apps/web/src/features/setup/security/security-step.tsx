// Device Security wizard step — fourth step in the device setup wizard
// (epic #533, ADR 0028). Collects an admin password (with confirmation)
// that protects access to the Glaon app on this device.
//
// User flow (per #547 product decision — Figma frame ships later):
//
// 1. Password field + Confirm field (both `PasswordInput`).
// 2. Validation: both filled, min length 8, the two match.
// 3. On Next: hash with SHA-256 via Web Crypto, write `securityPinHash`
//    (schema field name from #535 — kept for backwards compat with the
//    ConfigStore shape even though we collect a password, not a PIN).
//
// The plaintext password never leaves the route's bellek state. v1 has
// no "skip" affordance — the wizard's gating semantics treat the
// admin password as required for protected setup. Skip can be added in
// a follow-up once we know whether kiosk deployments want it.

import { Button, InputBase, PasswordInput, TextField, useToast } from '@glaon/ui';
import { useId, useMemo, useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput } from '@glaon/core/config';

import { useDeviceConfig } from '../../../config/config-provider';
import { WizardBackButton } from '../wizard-back-button';

interface SecurityStepProps {
  /** Partial DeviceConfig collected from earlier steps in this run. */
  readonly collected: DeviceConfigInput;
  /** Merge the form's output into `collected` and advance to the next step. */
  readonly onNext: (partial: DeviceConfigInput) => void;
  /** Go back one step (#637). */
  readonly onBack?: () => void;
}

const MIN_PASSWORD_LENGTH = 8;
// Admin username (#640): 3–32 chars of letters, digits, dot, underscore,
// hyphen. Mirrors @glaon/core's DeviceConfig `adminUsername` regex.
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type PasswordValidation =
  | { readonly kind: 'ok' }
  | { readonly kind: 'too-short' }
  | { readonly kind: 'mismatch' }
  | { readonly kind: 'empty' };

// When `allowEmpty` is true the device already has a password, so leaving
// both fields blank is valid — it means "keep the current password" (#651).
// Entering one field still requires both (partial entry is an error).
function validatePasswords(
  password: string,
  confirm: string,
  allowEmpty: boolean,
): PasswordValidation {
  if (password === '' && confirm === '') return allowEmpty ? { kind: 'ok' } : { kind: 'empty' };
  if (password === '' || confirm === '') return { kind: 'empty' };
  if (password.length < MIN_PASSWORD_LENGTH) return { kind: 'too-short' };
  if (password !== confirm) return { kind: 'mismatch' };
  return { kind: 'ok' };
}

export function SecurityStep({ collected, onNext, onBack }: SecurityStepProps): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const { config, setPartial } = useDeviceConfig();
  const usernameId = useId();
  const passwordId = useId();
  const confirmId = useId();

  // The device already has a password when a `securityPinHash` is stored
  // (re-running setup / editing). Then the password change is optional:
  // blank fields keep the current password (#651).
  const hasExistingPassword =
    config?.securityPinHash !== undefined && config.securityPinHash !== '';

  // Username seeds from the in-run value first (back-navigation, #637),
  // then the device's stored config (#651). Fresh setup → blank.
  const [username, setUsername] = useState<string>(
    collected.adminUsername ?? config?.adminUsername ?? '',
  );
  const [password, setPassword] = useState<string>('');
  const [confirm, setConfirm] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [isHashing, setIsHashing] = useState<boolean>(false);

  const usernameTrimmed = username.trim();
  const usernameValid = USERNAME_RE.test(usernameTrimmed);
  const validation = useMemo(
    () => validatePasswords(password, confirm, hasExistingPassword),
    [password, confirm, hasExistingPassword],
  );
  const showErrors = submitted && validation.kind !== 'ok';
  const usernameInvalid = submitted && !usernameValid;
  const usernameErrorMessage = usernameInvalid
    ? usernameTrimmed === ''
      ? t('setup.security.username.required')
      : t('setup.security.username.invalid')
    : undefined;

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitted(true);
    if (!usernameValid || validation.kind !== 'ok') return;

    setIsHashing(true);
    try {
      // Build the slice: always the username; the hash only when a new
      // password was entered (blank keeps the stored one — #651).
      const partial: DeviceConfigInput = { adminUsername: usernameTrimmed };
      if (password !== '') partial.securityPinHash = await sha256Hex(password);
      // Per-step save (#653): persist to the device's ConfigStore now, then
      // advance. A merge write, so omitting `securityPinHash` keeps the
      // existing one.
      await setPartial(partial);
      onNext(partial);
    } catch {
      // Web Crypto failure (no `crypto.subtle`) or a ConfigStore write
      // error — surface via Toast per the API Error Toast Rule.
      toast.show({
        intent: 'danger',
        title: t('setup.security.hashFailed.title'),
        description: t('setup.security.hashFailed.description'),
      });
    } finally {
      setIsHashing(false);
    }
  };

  const passwordErrorMessage =
    showErrors && (validation.kind === 'empty' || validation.kind === 'too-short')
      ? validation.kind === 'empty'
        ? t('setup.security.password.required')
        : t('setup.security.password.tooShort', { min: MIN_PASSWORD_LENGTH })
      : undefined;
  const confirmErrorMessage =
    showErrors && validation.kind === 'mismatch'
      ? t('setup.security.confirm.mismatch')
      : showErrors && validation.kind === 'empty' && confirm === ''
        ? t('setup.security.confirm.confirmRequired')
        : undefined;

  return (
    <div className="flex flex-col p-8 lg:p-12">
      <header className="flex flex-col gap-1 pb-6">
        <h1 className="text-display-xs font-semibold text-primary">{t('setup.security.title')}</h1>
        <p className="text-sm text-tertiary">{t('setup.security.subtitle')}</p>
      </header>

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
        className="flex flex-col"
      >
        <FormRow label={t('setup.security.username.label')} htmlFor={usernameId} required>
          <TextField
            value={username}
            onChange={setUsername}
            isRequired
            isInvalid={usernameInvalid}
            aria-label={t('setup.security.username.label')}
          >
            <InputBase
              id={usernameId}
              type="text"
              placeholder={t('setup.security.username.placeholder')}
              autoComplete="username"
              data-testid="security-username"
            />
          </TextField>
          {usernameErrorMessage !== undefined && (
            <p role="alert" className="pt-1.5 text-sm text-error-primary">
              {usernameErrorMessage}
            </p>
          )}
        </FormRow>

        <FormRow
          label={t('setup.security.password.label')}
          htmlFor={passwordId}
          required={!hasExistingPassword}
        >
          <PasswordInput
            id={passwordId}
            value={password}
            onChange={setPassword}
            placeholder={t('setup.security.password.placeholder')}
            isRequired={!hasExistingPassword}
            autoComplete="new-password"
            {...(passwordErrorMessage !== undefined ? { error: passwordErrorMessage } : {})}
          />
          {hasExistingPassword && passwordErrorMessage === undefined && (
            <p className="pt-1.5 text-sm text-tertiary">
              {t('setup.security.password.optionalHint')}
            </p>
          )}
        </FormRow>

        <FormRow
          label={t('setup.security.confirm.label')}
          htmlFor={confirmId}
          required={!hasExistingPassword}
        >
          <PasswordInput
            id={confirmId}
            value={confirm}
            onChange={setConfirm}
            placeholder={t('setup.security.confirm.placeholder')}
            isRequired={!hasExistingPassword}
            autoComplete="new-password"
            {...(confirmErrorMessage !== undefined ? { error: confirmErrorMessage } : {})}
          />
        </FormRow>

        <div className="flex items-center justify-between gap-3 border-t border-secondary py-6">
          {onBack !== undefined ? <WizardBackButton onBack={onBack} /> : <span />}
          <Button type="submit" size="md" isLoading={isHashing}>
            {t('setup.security.actions.next')}
          </Button>
        </div>
      </form>
    </div>
  );
}

interface FormRowProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly children: ReactNode;
}

function FormRow({ label, htmlFor, required = false, children }: FormRowProps): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-secondary py-5 sm:grid-cols-[240px_1fr] sm:items-start sm:gap-8">
      <label htmlFor={htmlFor} className="pt-2 text-sm font-semibold text-secondary">
        {label}
        {required && (
          <span aria-hidden="true" className="text-error-primary">
            {' *'}
          </span>
        )}
      </label>
      <div className="max-w-[480px]">{children}</div>
    </div>
  );
}
