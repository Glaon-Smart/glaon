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

import { Button, PasswordInput, useToast } from '@glaon/ui';
import { useId, useMemo, useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput } from '@glaon/core/config';

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

function validatePasswords(password: string, confirm: string): PasswordValidation {
  if (password === '' || confirm === '') return { kind: 'empty' };
  if (password.length < MIN_PASSWORD_LENGTH) return { kind: 'too-short' };
  if (password !== confirm) return { kind: 'mismatch' };
  return { kind: 'ok' };
}

export function SecurityStep({
  collected: _collected,
  onNext,
  onBack,
}: SecurityStepProps): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const passwordId = useId();
  const confirmId = useId();

  const [password, setPassword] = useState<string>('');
  const [confirm, setConfirm] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [isHashing, setIsHashing] = useState<boolean>(false);

  const validation = useMemo(() => validatePasswords(password, confirm), [password, confirm]);
  const showErrors = submitted && validation.kind !== 'ok';

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitted(true);
    if (validation.kind !== 'ok') return;
    setIsHashing(true);
    try {
      const hash = await sha256Hex(password);
      onNext({ securityPinHash: hash });
    } catch {
      // Web Crypto failure is extremely rare (older browsers without
      // `crypto.subtle`). Surface via Toast per the API Error Toast
      // Rule so the user has somewhere to read the failure.
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
        <FormRow label={t('setup.security.password.label')} htmlFor={passwordId} required>
          <PasswordInput
            id={passwordId}
            value={password}
            onChange={setPassword}
            placeholder={t('setup.security.password.placeholder')}
            isRequired
            autoComplete="new-password"
            {...(passwordErrorMessage !== undefined ? { error: passwordErrorMessage } : {})}
          />
        </FormRow>

        <FormRow label={t('setup.security.confirm.label')} htmlFor={confirmId} required>
          <PasswordInput
            id={confirmId}
            value={confirm}
            onChange={setConfirm}
            placeholder={t('setup.security.confirm.placeholder')}
            isRequired
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
