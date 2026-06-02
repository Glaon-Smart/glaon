// Layout Setup wizard step — second step in the device setup wizard
// (epic #533, ADR 0028). Multi-floor + rooms editor (#592).
//
// On entry the step seeds its editor from the device's existing HA
// floors + areas (#638), read from the unified `GET /api/setup` (#678)
// `layout` section: the current registries normalized into
// floors-with-rooms (+ floorless areas under `unassigned`), which we map
// into the editor's initial state. The user
// then adds / edits on top. When the wizard already collected a layout
// (re-entry / back-navigation), that takes precedence and the device
// read is skipped. A 503 (HA Core not configured — HA-less dev) is
// expected and degrades silently to a blank default floor; a real fetch
// failure surfaces a Toast (API Error Toast Rule) and also degrades.
//
// UX:
//   - Tab strip of floors at the top; the active tab's rooms render below.
//   - Rooms render as a responsive card grid.
//   - Per-field validation is inline; only the device-read failure uses
//     Toast (it's a cross-section, network-level signal).

import { useToast } from '@glaon/ui';
import { useCallback, useEffect, useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { HaLayoutResponse } from '@glaon/core/api-client';
import type { DeviceConfigInput, Layout } from '@glaon/core/config';

import { WizardBackButton } from '../wizard-back-button';
import { FloorTabs } from './floor-tabs';
import { fetchLayoutSeed, saveLayout } from './layout-api';
import { RoomGrid } from './room-grid';
import { useLayoutState } from './use-layout-state';

interface LayoutStepProps {
  /** Partial DeviceConfig collected from earlier steps in this run. */
  readonly collected: DeviceConfigInput;
  /** Merge the form's output into `collected` and advance to the next step. */
  readonly onNext: (partial: DeviceConfigInput) => void;
  /** Go back one step (#637). */
  readonly onBack?: () => void;
}

const MAX_FLOORS = 10;
const MAX_ROOMS_PER_FLOOR = 50;

/**
 * Map the device's HA floors/areas into the editor's seed `Layout`.
 * Floorless areas go under a default-named floor (naming is the UI's
 * job). Caps to the editor's floor/room maxima so the seed stays
 * schema-valid. Returns `undefined` when there's nothing to seed, letting
 * `useLayoutState` create its single blank floor.
 */
function mapHaLayoutToSeed(resp: HaLayoutResponse, defaultFloorName: string): Layout | undefined {
  const floors: Layout['floors'][number][] = resp.floors.slice(0, MAX_FLOORS).map((floor) => ({
    id: floor.id,
    name: floor.name,
    rooms: floor.rooms
      .slice(0, MAX_ROOMS_PER_FLOOR)
      .map((room) => ({ id: room.id, name: room.name })),
  }));
  if (resp.unassigned.length > 0 && floors.length < MAX_FLOORS) {
    floors.push({
      id: crypto.randomUUID(),
      name: defaultFloorName,
      rooms: resp.unassigned.slice(0, MAX_ROOMS_PER_FLOOR).map((room) => ({
        id: room.id,
        name: room.name,
      })),
    });
  }
  return floors.length > 0 ? { floors } : undefined;
}

export function LayoutStep({ collected, onNext, onBack }: LayoutStepProps): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const defaultFloorName = t('setup.layoutSetup.defaultFloorName');

  // `collected.layout` present → reuse it (re-entry / back-nav) and skip
  // the device read; absent → fetch the device's HA layout to pre-fill.
  const [phase, setPhase] = useState<'loading' | 'ready'>(
    collected.layout !== undefined ? 'ready' : 'loading',
  );
  const [seed, setSeed] = useState<Layout | undefined>(collected.layout);

  const showLoadError = useCallback(() => {
    toast.show({
      intent: 'danger',
      title: t('setup.layoutSetup.loadFailed.title'),
      description: t('setup.layoutSetup.loadFailed.description'),
    });
  }, [t, toast]);

  useEffect(() => {
    if (collected.layout !== undefined) return;
    // No unmount guard needed: this effect runs once (collected.layout is
    // stable while on the step), and a setState after unmount is a no-op
    // in React 19.
    void (async () => {
      // Seed the Layout section from the unified `GET /api/setup` (#678).
      // A null section (HA Core unconfigured) / 503 (backend down) is a
      // silent no-seed; only a real fetch failure surfaces a Toast.
      const result = await fetchLayoutSeed();
      if (!result.ok) {
        showLoadError();
      } else if (result.layout !== null) {
        setSeed(mapHaLayoutToSeed(result.layout, defaultFloorName));
      }
      setPhase('ready');
    })();
  }, [collected.layout, defaultFloorName, showLoadError]);

  if (phase === 'loading') {
    return (
      <div className="flex flex-col p-8 lg:p-12">
        <LayoutHeader />
        <p role="status" className="pt-2 text-sm text-tertiary">
          {t('setup.layoutSetup.loading')}
        </p>
      </div>
    );
  }

  return (
    <LayoutEditor
      initialLayout={seed}
      onNext={onNext}
      {...(onBack !== undefined ? { onBack } : {})}
    />
  );
}

function LayoutHeader(): ReactNode {
  const { t } = useTranslation();
  return (
    <header className="flex flex-col gap-1 pb-6">
      <h1 className="text-display-xs font-semibold text-primary">{t('setup.layoutSetup.title')}</h1>
      <p className="text-sm text-tertiary">{t('setup.layoutSetup.subtitle')}</p>
    </header>
  );
}

interface LayoutEditorProps {
  readonly initialLayout: Layout | undefined;
  readonly onNext: (partial: DeviceConfigInput) => void;
  readonly onBack?: () => void;
}

function LayoutEditor({ initialLayout, onNext, onBack }: LayoutEditorProps): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const { state, actions, toLayout } = useLayoutState({
    defaultFloorName: t('setup.layoutSetup.defaultFloorName'),
    ...(initialLayout !== undefined ? { initial: initialLayout } : {}),
  });

  const activeFloor =
    state.floors.find((floor) => floor.id === state.activeFloorId) ?? state.floors[0];

  // Per-step save (#652): reconcile the layout to the device before
  // advancing. Idempotent, so a back-nav re-save doesn't duplicate. An
  // `error` keeps the user here + surfaces a Toast; `ok`/`skipped` advance.
  const onSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSaving) return;
    const layout = toLayout();
    setIsSaving(true);
    const outcome = await saveLayout(layout);
    if (outcome === 'error') {
      setIsSaving(false);
      toast.show({
        intent: 'danger',
        title: t('setup.layoutSetup.saveFailed.title'),
        description: t('setup.layoutSetup.saveFailed.description'),
      });
      return;
    }
    onNext({ layout });
  };

  const onAddFloor = (): void => {
    actions.addFloor(
      t('setup.layoutSetup.newFloorNameTemplate', { index: state.floors.length + 1 }),
    );
  };

  const onAddRoom = (): void => {
    if (activeFloor === undefined) return;
    actions.addRoom(
      activeFloor.id,
      t('setup.layoutSetup.newRoomNameTemplate', { index: activeFloor.rooms.length + 1 }),
    );
  };

  return (
    <div className="flex flex-col p-8 lg:p-12">
      <LayoutHeader />

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
        className="flex flex-col gap-6"
      >
        <FloorTabs
          floors={state.floors}
          activeFloorId={state.activeFloorId}
          onSwitch={actions.switchFloor}
          onAddFloor={onAddFloor}
          onRenameFloor={actions.renameFloor}
          onRemoveFloor={actions.removeFloor}
          canAddMore={state.floors.length < MAX_FLOORS}
        />

        {activeFloor !== undefined && (
          <RoomGrid
            floor={activeFloor}
            onAddRoom={onAddRoom}
            onRenameRoom={(roomId, name) => {
              actions.renameRoom(activeFloor.id, roomId, name);
            }}
            onChangeRoomType={(roomId, type) => {
              actions.changeRoomType(activeFloor.id, roomId, type);
            }}
            onRemoveRoom={(roomId) => {
              actions.removeRoom(activeFloor.id, roomId);
            }}
            canAddMore={activeFloor.rooms.length < MAX_ROOMS_PER_FLOOR}
          />
        )}

        <div className="flex items-center justify-between gap-3 border-t border-secondary pt-6">
          {onBack !== undefined ? <WizardBackButton onBack={onBack} /> : <span />}
          <button
            type="submit"
            disabled={isSaving}
            aria-busy={isSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-xs-skeuomorphic hover:bg-brand-solid_hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span>{t('setup.layoutSetup.actions.next')}</span>
            {isSaving ? <SavingSpinner /> : <NextArrowIcon />}
          </button>
        </div>
      </form>
    </div>
  );
}

function NextArrowIcon(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.167 10h11.666m0 0L10 4.167M15.833 10 10 15.833" />
    </svg>
  );
}

// Inline loading spinner shown on Next while the layout is saved (#652).
function SavingSpinner(): ReactNode {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
