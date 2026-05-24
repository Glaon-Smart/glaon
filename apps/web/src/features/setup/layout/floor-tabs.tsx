// Floor tab strip — horizontal pills + `+ Add Floor` at the end.
// Each pill carries the floor name, a room-count badge, and a × to
// remove (hidden when only one floor exists). Clicking the name
// turns it into an inline rename input.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Floor } from '@glaon/core/config';

import { PlusIcon, XCloseIcon } from './step-icons';

interface FloorTabsProps {
  readonly floors: readonly Floor[];
  readonly activeFloorId: string;
  readonly onSwitch: (floorId: string) => void;
  readonly onAddFloor: () => void;
  readonly onRenameFloor: (floorId: string, name: string) => void;
  readonly onRemoveFloor: (floorId: string) => void;
  readonly canAddMore: boolean;
}

export function FloorTabs({
  floors,
  activeFloorId,
  onSwitch,
  onAddFloor,
  onRenameFloor,
  onRemoveFloor,
  canAddMore,
}: FloorTabsProps): ReactNode {
  const { t } = useTranslation();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId !== null) renameRef.current?.focus();
  }, [renamingId]);

  const commitRename = (floorId: string, value: string): void => {
    onRenameFloor(floorId, value);
    setRenamingId(null);
  };

  const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>, floor: Floor): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename(floor.id, event.currentTarget.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setRenamingId(null);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={t('setup.layoutSetup.floors.tabsLabel')}
      className="flex flex-wrap items-center gap-2"
    >
      {floors.map((floor) => {
        const isActive = floor.id === activeFloorId;
        const isRenaming = renamingId === floor.id;
        const showRemove = floors.length > 1;
        return (
          <div
            key={floor.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`floor-panel-${floor.id}`}
            className={
              'group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ' +
              (isActive
                ? 'bg-brand-solid text-white shadow-xs-skeuomorphic'
                : 'bg-secondary text-secondary hover:bg-tertiary hover:text-primary')
            }
          >
            {isRenaming ? (
              <input
                ref={renameRef}
                defaultValue={floor.name}
                aria-label={t('setup.layoutSetup.floors.renameFloor')}
                onBlur={(event) => {
                  commitRename(floor.id, event.target.value);
                }}
                onKeyDown={(event) => {
                  onRenameKeyDown(event, floor);
                }}
                className="w-32 rounded-sm bg-transparent text-sm font-medium text-inherit outline-none ring-1 ring-white/40 focus:ring-2 focus:ring-white"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (isActive) {
                    setRenamingId(floor.id);
                  } else {
                    onSwitch(floor.id);
                  }
                }}
                onDoubleClick={() => {
                  setRenamingId(floor.id);
                }}
                className="text-inherit focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 rounded-sm"
              >
                {floor.name}
              </button>
            )}
            <span
              className={
                'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ' +
                (isActive ? 'bg-white/20 text-white' : 'bg-primary text-tertiary')
              }
              aria-label={t('setup.layoutSetup.floors.roomCountBadge', {
                count: floor.rooms.length,
              })}
            >
              {floor.rooms.length}
            </span>
            {showRemove && !isRenaming && (
              <button
                type="button"
                onClick={() => {
                  onRemoveFloor(floor.id);
                }}
                className={
                  'inline-flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 ' +
                  (isActive ? 'focus-visible:ring-white' : 'focus-visible:ring-brand')
                }
                aria-label={t('setup.layoutSetup.floors.removeFloor', { name: floor.name })}
              >
                <XCloseIcon className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}

      {canAddMore && (
        <button
          type="button"
          onClick={onAddFloor}
          className="inline-flex items-center gap-2 rounded-full border border-dashed border-secondary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:border-brand hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <PlusIcon className="size-4" />
          <span>{t('setup.layoutSetup.floors.addFloor')}</span>
        </button>
      )}
    </div>
  );
}
