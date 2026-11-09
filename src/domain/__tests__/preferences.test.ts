/** What is stored for a preference, and what comes back. */
import {
  GROUP_LABEL,
  isPreference,
  readPreferences,
  TRAIL_PREFERENCES,
  writePreferences,
} from '../preferences';

describe('the catalogue', () => {
  it('has no repeated identifier', () => {
    const ids = TRAIL_PREFERENCES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('labels every group it uses', () => {
    for (const p of TRAIL_PREFERENCES) {
      expect(GROUP_LABEL[p.group]).toBeTruthy();
    }
  });

  it('recognises its own identifiers and nothing else', () => {
    expect(isPreference('summit')).toBe(true);
    expect(isPreference('parapente')).toBe(false);
  });
});

describe('writing', () => {
  it('keeps the order of the catalogue and not the order they were tapped', () => {
    // So that two people who chose the same things store the same string.
    const one = writePreferences(['forest', 'short']);
    const other = writePreferences(['short', 'forest']);
    expect(one).toBe(other);
    expect(JSON.parse(one)).toEqual(['short', 'forest']);
  });

  it('drops anything the catalogue does not know', () => {
    expect(JSON.parse(writePreferences(['summit', 'parapente']))).toEqual(['summit']);
  });

  it('drops a repeated choice', () => {
    expect(JSON.parse(writePreferences(['summit', 'summit']))).toEqual(['summit']);
  });

  it('writes an empty list for somebody who chose nothing', () => {
    // Which is a different stored value from null, and the difference is
    // whether they were ever asked.
    expect(writePreferences([])).toBe('[]');
  });
});

describe('reading', () => {
  it('returns what was written', () => {
    const chosen = ['short', 'summit', 'quiet'];
    expect(readPreferences(writePreferences(chosen))).toEqual(chosen);
  });

  it('treats never asked as nothing chosen', () => {
    expect(readPreferences(null)).toEqual([]);
  });

  it('drops an identifier a later version wrote', () => {
    // A device that ran a newer build and came back finds a value it
    // cannot render, and dropping it quietly beats refusing to read the
    // profile at all.
    expect(readPreferences('["summit","parapente"]')).toEqual(['summit']);
  });

  it('survives a stored value that is not a list', () => {
    expect(readPreferences('"summit"')).toEqual([]);
    expect(readPreferences('{"a":1}')).toEqual([]);
  });

  it('survives a stored value that is not JSON at all', () => {
    expect(readPreferences('summit,quiet')).toEqual([]);
  });

  it('drops entries that are not text', () => {
    expect(readPreferences('["summit",7,null]')).toEqual(['summit']);
  });
});
