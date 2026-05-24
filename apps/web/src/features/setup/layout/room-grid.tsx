// Room grid for the active floor — responsive card grid + an
// add-room button. Empty state shows a centered hint card with the
// CTA so the user knows what to do on a fresh floor.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Floor, Room, RoomType } from '@glaon/core/config';

import { RoomCard } from './room-card';
import { PlusIcon } from './step-icons';

interface RoomGridProps {
  readonly floor: Floor;
  readonly onAddRoom: () => void;
  readonly onRenameRoom: (roomId: string, name: string) => void;
  readonly onChangeRoomType: (roomId: string, type: RoomType | undefined) => void;
  readonly onRemoveRoom: (roomId: string) => void;
  readonly canAddMore: boolean;
}

export function RoomGrid({
  floor,
  onAddRoom,
  onRenameRoom,
  onChangeRoomType,
  onRemoveRoom,
  canAddMore,
}: RoomGridProps): ReactNode {
  const { t } = useTranslation();

  if (floor.rooms.length === 0) {
    return (
      <div
        id={`floor-panel-${floor.id}`}
        role="tabpanel"
        className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-secondary bg-secondary/40 px-6 py-12 text-center"
      >
        <div className="text-5xl" aria-hidden="true">
          🏠
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-md font-semibold text-primary">
            {t('setup.layoutSetup.rooms.emptyTitle', { floor: floor.name })}
          </p>
          <p className="max-w-md text-sm text-tertiary">{t('setup.layoutSetup.rooms.emptyHint')}</p>
        </div>
        {canAddMore && (
          <button
            type="button"
            onClick={onAddRoom}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-xs-skeuomorphic transition-colors hover:bg-brand-solid_hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <PlusIcon className="size-4" />
            <span>{t('setup.layoutSetup.rooms.addFirstRoom')}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div id={`floor-panel-${floor.id}`} role="tabpanel" className="flex flex-col gap-4">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {floor.rooms.map((room: Room) => (
          <li key={room.id}>
            <RoomCard
              room={room}
              onRename={(name) => {
                onRenameRoom(room.id, name);
              }}
              onChangeType={(type) => {
                onChangeRoomType(room.id, type);
              }}
              onRemove={() => {
                onRemoveRoom(room.id);
              }}
            />
          </li>
        ))}
      </ul>

      {canAddMore && (
        <button
          type="button"
          onClick={onAddRoom}
          className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-dashed border-secondary px-4 py-2 text-sm font-semibold text-secondary transition-colors hover:border-brand hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <PlusIcon className="size-4" />
          <span>{t('setup.layoutSetup.rooms.addRoom')}</span>
        </button>
      )}
    </div>
  );
}
