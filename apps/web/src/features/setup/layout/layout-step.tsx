// Layout Setup wizard step — second step in the device setup wizard
// (epic #533, ADR 0028). Multi-floor + rooms editor (#592).
//
// Replaces the v1 free-text placeholder from #545. The previous
// single-string `layout?: string` field is gone — the schema now
// carries a structured `layout?: { floors: Floor[] }` blob. Phase 2
// has no production blobs that wrote the old shape so the swap is
// direct (see types.ts comment for the rationale).
//
// UX:
//   - Tab strip of floors at the top; the active tab's rooms render
//     below.
//   - Rooms render as a responsive card grid (1 column on phones,
//     2 on tablets, 3 on desktop).
//   - Each room card carries an emoji glyph driven by `RoomType`,
//     editable name, type selector, and a ×-on-hover remove.
//   - Empty floor: centred CTA with a 🏠 glyph and "Add your first
//     room" copy.
//   - Default state seeded by `useLayoutState`: one floor named per
//     i18n (`Ground Floor` / `Zemin Kat`), empty rooms list.
//
// Per the API Error Toast Rule (CLAUDE.md), per-field validation
// is inline / inline-only; nothing here goes through Toast because
// nothing leaves the device.

import type { ReactNode, SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput } from '@glaon/core/config';

import { WizardBackButton } from '../wizard-back-button';
import { FloorTabs } from './floor-tabs';
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

export function LayoutStep({ collected, onNext, onBack }: LayoutStepProps): ReactNode {
  const { t } = useTranslation();

  const { state, actions, toLayout } = useLayoutState({
    defaultFloorName: t('setup.layoutSetup.defaultFloorName'),
    ...(collected.layout !== undefined ? { initial: collected.layout } : {}),
  });

  const activeFloor =
    state.floors.find((floor) => floor.id === state.activeFloorId) ?? state.floors[0];

  const onSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onNext({ layout: toLayout() });
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
      <header className="flex flex-col gap-1 pb-6">
        <h1 className="text-display-xs font-semibold text-primary">
          {t('setup.layoutSetup.title')}
        </h1>
        <p className="text-sm text-tertiary">{t('setup.layoutSetup.subtitle')}</p>
      </header>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
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
            className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-xs-skeuomorphic hover:bg-brand-solid_hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span>{t('setup.layoutSetup.actions.next')}</span>
            <NextArrowIcon />
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
