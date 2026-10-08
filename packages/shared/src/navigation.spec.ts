import { describe, expect, it } from 'vitest';
import { ROLE_NAVIGATION, navigationForRoles } from './navigation.js';

describe('role navigation (page 4)', () => {
  it('builds stable kebab-case paths', () => {
    const teacher = ROLE_NAVIGATION.teacher.map((i) => i.path);
    expect(teacher).toContain('/todays-classes');
    expect(teacher).toContain('/exams-marks');
    expect(ROLE_NAVIGATION.school_admin.map((i) => i.path)).toContain('/exams-and-results');
  });

  it('merges multiple roles without duplicates', () => {
    const merged = navigationForRoles(['teacher', 'parent']);
    const paths = merged.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths[0]).toBe('/');
    expect(paths).toContain('/my-children');
    expect(paths).toContain('/start-class');
  });
});
