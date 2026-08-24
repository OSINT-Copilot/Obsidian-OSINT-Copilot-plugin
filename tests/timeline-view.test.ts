import { describe, it, expect } from 'vitest';
import { sortTimelineEventsForDisplay, TimelineEvent } from '../src/views/timeline-view';

function ev(id: string, start: Date | null, end?: Date): TimelineEvent {
    return { id, label: id, start, end, color: '#000000' };
}

describe('sortTimelineEventsForDisplay', () => {
    it('places undated events first, preserving their original order', () => {
        const a = ev('a', new Date('2024-01-01'));
        const undated1 = ev('undated1', null);
        const b = ev('b', new Date('2023-01-01'));
        const undated2 = ev('undated2', null);

        const result = sortTimelineEventsForDisplay([a, undated1, b, undated2]);

        expect(result.map((e) => e.id)).toEqual(['undated1', 'undated2', 'b', 'a']);
    });

    it('sorts dated events ascending (oldest first), unchanged from prior behavior', () => {
        const newest = ev('newest', new Date('2024-06-01'));
        const oldest = ev('oldest', new Date('2020-01-01'));
        const middle = ev('middle', new Date('2022-01-01'));

        const result = sortTimelineEventsForDisplay([newest, oldest, middle]);

        expect(result.map((e) => e.id)).toEqual(['oldest', 'middle', 'newest']);
    });

    it('handles an all-undated list without throwing', () => {
        const result = sortTimelineEventsForDisplay([ev('a', null), ev('b', null)]);
        expect(result.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('handles an all-dated list identically to a plain ascending sort', () => {
        const result = sortTimelineEventsForDisplay([
            ev('b', new Date('2021-01-01')),
            ev('a', new Date('2020-01-01')),
        ]);
        expect(result.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('handles an empty list', () => {
        expect(sortTimelineEventsForDisplay([])).toEqual([]);
    });

    it('does not mutate/drop the `end` field while partitioning', () => {
        const end = new Date('2024-01-05');
        const result = sortTimelineEventsForDisplay([ev('a', new Date('2024-01-01'), end)]);
        expect(result[0].end).toBe(end);
    });
});
