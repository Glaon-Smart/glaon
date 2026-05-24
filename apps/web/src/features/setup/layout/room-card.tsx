// One room — emoji glyph + editable name + type picker + remove
// button. Lives inside the floor's `RoomGrid` (one card per room).
//
// The remove × surfaces on hover (`group-hover:opacity-100`) so the
// resting card looks clean. Focus-within keeps it visible for
// keyboard users.

import { NativeSelect } from '@glaon/ui';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Room, RoomType } from '@glaon/core/config';

import { RoomTypeIcon } from './room-type-icon';
import { XCloseIcon } from './step-icons';

const ROOM_TYPES = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living',
  'office',
  'dining',
  'garage',
  'garden',
  'other',
] as const satisfies readonly RoomType[];

interface RoomCardProps {
  readonly room: Room;
  readonly onRename: (next: string) => void;
  readonly onChangeType: (next: RoomType | undefined) => void;
  readonly onRemove: () => void;
}

export function RoomCard({ room, onRename, onChangeType, onRemove }: RoomCardProps): ReactNode {
  const { t } = useTranslation();
  const nameId = useId();

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary transition-shadow hover:shadow-md focus-within:shadow-md focus-within:ring-brand">
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-tertiary opacity-0 transition-opacity hover:bg-secondary hover:text-primary group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        aria-label={t('setup.layoutSetup.rooms.removeRoom', { name: room.name })}
      >
        <XCloseIcon className="size-4" />
      </button>

      <RoomTypeIcon {...(room.type !== undefined ? { type: room.type } : {})} size="lg" />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className="sr-only">
          {t('setup.layoutSetup.rooms.nameLabel')}
        </label>
        <input
          id={nameId}
          type="text"
          value={room.name}
          onChange={(event) => {
            onRename(event.target.value);
          }}
          onBlur={(event) => {
            // Restore the previous label when the user empties the
            // field — the schema requires non-empty room names.
            if (event.target.value.trim() === '') onRename(room.name);
          }}
          placeholder={t('setup.layoutSetup.rooms.namePlaceholder')}
          className="w-full rounded-md bg-transparent text-md font-semibold text-primary outline-none ring-1 ring-transparent transition-shadow placeholder:text-placeholder hover:ring-secondary focus:ring-2 focus:ring-brand"
        />

        <NativeSelect
          aria-label={t('setup.layoutSetup.rooms.typeLabel')}
          value={room.type ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            onChangeType(next === '' ? undefined : (next as RoomType));
          }}
          options={[
            { value: '', label: t('setup.layoutSetup.rooms.types.none') },
            ...ROOM_TYPES.map((kind) => ({
              value: kind,
              label: t(`setup.layoutSetup.rooms.types.${kind}`),
            })),
          ]}
        />
      </div>
    </div>
  );
}
