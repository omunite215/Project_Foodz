import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';

/*
 * The empty board (F5 design 2.13, A2.6): the column headers stay with "0", and one message
 * spans them. With filters hiding everything, the same block without the picture.
 */
export function BoardEmpty({
  kind,
  soundOn,
  onTurnOnSound,
  onClearFilters,
}: {
  kind: 'board' | 'filtered';
  soundOn: boolean;
  onTurnOnSound: () => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="col-span-full px-4 py-12">
      {kind === 'board' ? (
        <EmptyState
          illustration="noData"
          illustrationSize="compact"
          title="No orders right now"
          description="New orders appear here as soon as they're paid. Turn on sound so you hear them."
          action={
            soundOn ? undefined : (
              <Button type="button" variant="outline" size="kitchen" onClick={onTurnOnSound}>
                Turn on sound
              </Button>
            )
          }
        />
      ) : (
        <EmptyState
          title="No matching orders"
          description="No orders match these filters."
          action={
            <Button type="button" variant="outline" size="kitchen" onClick={onClearFilters}>
              Clear filters
            </Button>
          }
        />
      )}
    </div>
  );
}
