import { describe, expect, it } from 'vitest';
import { checkAnswers, cleanCustomForm, readCustomForm, type CustomFormDto } from './custom-form.js';

const dto = (fields: CustomFormDto['fields']): CustomFormDto => ({ intro: null, fields });
const f = (over: Record<string, unknown>) => ({ id: 'a', type: 'text', label: 'Label', required: false, ...over }) as CustomFormDto['fields'][number];

describe('designing a form', () => {
  it('keeps only what each type uses', () => {
    const form = cleanCustomForm(dto([f({ type: 'number', min: 1, max: 5, minLength: 3, options: ['x'] })]));
    expect(form.fields[0]).toMatchObject({ min: 1, max: 5, minLength: null, options: [] });
  });
  it('refuses duplicate or reserved ids, empty choices and impossible limits', () => {
    expect(() => cleanCustomForm(dto([f({ id: 'a' }), f({ id: 'a' })]))).toThrow();
    expect(() => cleanCustomForm(dto([f({ id: 'email' })]), ['email'])).toThrow();
    expect(() => cleanCustomForm(dto([f({ type: 'select' })]))).toThrow(/choice/);
    expect(() => cleanCustomForm(dto([f({ type: 'number', min: 9, max: 1 })]))).toThrow();
  });
  it('reads damaged stored JSON without throwing', () => {
    expect(readCustomForm(null).fields).toEqual([]);
    expect(readCustomForm({ fields: [{ id: 'x', type: 'bogus' }, { id: 'y', type: 'text', label: 'Y', required: true }] }).fields).toHaveLength(1);
  });
});

describe('answering a form', () => {
  const form = cleanCustomForm(dto([
    f({ id: 'name', required: true, maxLength: 5 }),
    f({ id: 'age', type: 'number', min: 3, max: 20 }),
    f({ id: 'house', type: 'select', options: ['Red', 'Blue'] }),
    f({ id: 'clubs', type: 'multiselect', options: ['Art', 'Chess'] }),
    f({ id: 'agree', type: 'checkbox', required: true }),
    f({ id: 'dob', type: 'date' }),
    f({ id: 'mail', type: 'email' }),
  ]));
  it('accepts good answers and drops unknown ones', () => {
    const r = checkAnswers(form, { name: ' Ali ', age: '10', house: 'Red', clubs: ['Art', 'Art'], agree: true, dob: '2015-03-02', mail: 'A@B.CO', hack: 'x' });
    expect(r.errors).toEqual({});
    expect(r.answers).toEqual({ name: 'Ali', age: 10, house: 'Red', clubs: ['Art'], agree: true, dob: '2015-03-02', mail: 'a@b.co' });
  });
  it('reports every wrong answer', () => {
    const r = checkAnswers(form, { name: 'too long name', age: 99, house: 'Green', clubs: ['Golf'], dob: 'x', mail: 'no' });
    expect(Object.keys(r.errors).sort()).toEqual(['age', 'agree', 'clubs', 'dob', 'house', 'mail', 'name']);
  });
  it('a required field may not be empty, an optional one may', () => {
    expect(checkAnswers(form, { agree: true }).errors).toEqual({ name: 'Label is required' });
    expect(checkAnswers(form, { name: 'ab', agree: false }).errors.agree).toBeTruthy();
  });
});

describe('documents and sections', () => {
  const file = (over: Record<string, unknown> = {}) => ({ id: 'cnic', type: 'file', label: 'CNIC copy', required: true, ...over }) as CustomFormDto['fields'][number];
  it('document fields are refused where no document can be attached', () => {
    expect(() => cleanCustomForm(dto([file()]))).toThrow(/document uploads/);
    expect(cleanCustomForm(dto([file()]), [], true).fields[0]).toMatchObject({ type: 'file', section: 'Documents' });
  });
  it('a document answer must name an uploaded document', () => {
    const form = cleanCustomForm(dto([file()]), [], true);
    expect(checkAnswers(form, {}).errors.cnic).toBeTruthy();
    expect(checkAnswers(form, { cnic: 'nope' }).errors.cnic).toBeTruthy();
    const ok = checkAnswers(form, { cnic: { documentId: '01a1817e-9bfa-7055-bb4a-b2bda20ed1cb', fileName: 'cnic.pdf' } });
    expect(ok.errors).toEqual({});
    expect(ok.answers.cnic).toEqual({ documentId: '01a1817e-9bfa-7055-bb4a-b2bda20ed1cb', fileName: 'cnic.pdf' });
  });
  it('keeps the section a field was placed under', () => {
    expect(cleanCustomForm(dto([{ ...file(), type: 'text', section: 'Family', required: false } as CustomFormDto['fields'][number]])).fields[0]!.section).toBe('Family');
  });
});
