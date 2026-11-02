import { BadRequestException } from '@nestjs/common';
import { answerOf, answerRow, checkApplication, cleanAdmissionForm, defaultAdmissionForm, readAdmissionForm, savedValues, throwFieldErrors, type AdmissionForm, type AdmissionFormDto, type FormField } from './admission-form.js';

const CLASS_1 = '0192a000-0000-7000-8000-000000000001';
const CLASS_5 = '0192a000-0000-7000-8000-000000000005';
const FILE = '0192a000-0000-7000-8000-0000000000ff';

const field = (f: Partial<FormField> & Pick<FormField, 'id' | 'type'>): FormField => ({
  label: f.id, section: 'additional', help: null, required: false, options: [], minLength: null, maxLength: null, min: null, max: null, classIds: [], saveTo: null, ...f,
});

function form(fields: FormField[], change: (f: AdmissionForm) => void = () => {}): AdmissionForm {
  const f = { ...defaultAdmissionForm(), fields };
  change(f);
  return f;
}

describe('checkApplication', () => {
  it('requires the photo by default, as the website always did', () => {
    expect(checkApplication(defaultAdmissionForm(), CLASS_1, {}, undefined).errors).toEqual({ photoId: "Student's photo is required" });
    expect(checkApplication(defaultAdmissionForm(), CLASS_1, { photoId: FILE }, undefined).errors).toEqual({});
  });

  it('follows the school: hidden standard fields are dropped, required ones enforced', () => {
    const f = form([], (x) => {
      x.builtins.photo = { enabled: false, required: false, label: null };
      x.builtins.guardianEmail = { enabled: true, required: true, label: 'Father email' };
    });
    const r = checkApplication(f, CLASS_1, { photoId: FILE }, undefined);
    expect(r.hidden).toContain('photoId');
    expect(r.errors).toEqual({ guardianEmail: 'Father email is required' });
  });

  it('checks each type and its limits', () => {
    const f = form([
      field({ id: 'cnic', type: 'text', required: true, minLength: 13, maxLength: 15 }),
      field({ id: 'siblings', type: 'number', min: 0, max: 10 }),
      field({ id: 'mail', type: 'email' }),
      field({ id: 'tel', type: 'phone' }),
      field({ id: 'joined', type: 'date' }),
      field({ id: 'transport', type: 'select', options: ['Yes', 'No'] }),
      field({ id: 'sports', type: 'multiselect', options: ['Cricket', 'Hockey'] }),
    ], (x) => { x.builtins.photo.required = false; });
    const bad = checkApplication(f, CLASS_1, {}, { cnic: '123', siblings: '11', mail: 'nope', tel: 'abc', joined: '2026-02-30', transport: 'Maybe', sports: ['Chess'] });
    expect(Object.keys(bad.errors).sort()).toEqual(['cnic', 'joined', 'mail', 'siblings', 'sports', 'tel', 'transport']);

    const good = checkApplication(f, CLASS_1, {}, { cnic: ' 35202-1234567-1 ', siblings: '2', mail: 'A@B.pk', tel: '+92 300 1234567', joined: '2026-02-28', transport: 'Yes', sports: ['Hockey', 'Hockey'] });
    expect(good.errors).toEqual({});
    expect(Object.fromEntries(good.answers.map((a) => [a.fieldId, a.value]))).toEqual({ cnic: '35202-1234567-1', siblings: 2, mail: 'a@b.pk', tel: '+92 300 1234567', joined: '2026-02-28', transport: 'Yes', sports: ['Hockey'] });
  });

  it('treats an unticked required box and a missing required document as missing', () => {
    const f = form([field({ id: 'agree', type: 'checkbox', required: true }), field({ id: 'bform', type: 'file', required: true, section: 'documents' })], (x) => { x.builtins.photo.required = false; });
    expect(checkApplication(f, CLASS_1, {}, { agree: false }).errors).toEqual({ agree: 'Please tick this box', bform: 'Please attach this document' });
    const ok = checkApplication(f, CLASS_1, {}, { agree: true, bform: FILE });
    expect(ok.errors).toEqual({});
    expect(ok.files).toEqual([{ fieldId: 'bform', label: 'bform', fileId: FILE }]);
  });

  it('asks class-filtered fields only for those classes and refuses unknown answers', () => {
    const f = form([field({ id: 'result', type: 'text', required: true, classIds: [CLASS_5] })], (x) => { x.builtins.photo.required = false; });
    expect(checkApplication(f, CLASS_1, {}, {}).errors).toEqual({});
    expect(checkApplication(f, CLASS_5, {}, {}).errors).toEqual({ result: 'This field is required' });
    expect(checkApplication(f, CLASS_1, {}, { result: 'A+' }).errors).toEqual({ result: 'This question is not asked for the chosen class' });
    expect(checkApplication(f, CLASS_1, {}, { hacked: 'x' }).errors).toEqual({ hacked: 'Unknown question' });
    expect(checkApplication(f, CLASS_1, {}, ['x']).errors).toHaveProperty('answers');
  });
});

describe('cleanAdmissionForm', () => {
  const dto = (fields: AdmissionFormDto['fields']): AdmissionFormDto => ({ intro: null, builtins: defaultAdmissionForm().builtins, fields });

  it('keeps only the settings each type uses and moves files to documents', () => {
    const [f] = cleanAdmissionForm(dto([{ id: 'doc', type: 'file', label: 'B-Form', section: 'student', required: true, options: ['x'], min: 1, maxLength: 9 }]), []).fields;
    expect(f).toMatchObject({ section: 'documents', options: [], min: null, maxLength: null });
  });

  it('refuses inconsistent fields', () => {
    expect(() => cleanAdmissionForm(dto([{ id: 'a', type: 'select', label: 'A', section: 'student', required: false, options: [' '] }]), [])).toThrow(BadRequestException);
    expect(() => cleanAdmissionForm(dto([{ id: 'a', type: 'text', label: 'A', section: 'student', required: false }, { id: 'a', type: 'text', label: 'B', section: 'student', required: false }]), [])).toThrow(/share the id/);
    expect(() => cleanAdmissionForm(dto([{ id: 'a', type: 'text', label: 'A', section: 'student', required: false, minLength: 9, maxLength: 3 }]), [])).toThrow(BadRequestException);
    expect(() => cleanAdmissionForm(dto([{ id: 'a', type: 'text', label: 'A', section: 'student', required: false, classIds: [CLASS_5] }]), [CLASS_1])).toThrow(/no longer exists/);
  });

  it('never stores a hidden field as required', () => {
    const d = dto([]);
    d.builtins = { ...d.builtins, notes: { enabled: false, required: true } };
    expect(cleanAdmissionForm(d, []).builtins.notes).toEqual({ enabled: false, required: false, label: null });
  });
});

describe('readAdmissionForm / throwFieldErrors', () => {
  it('fills in defaults for a missing or partial form', () => {
    expect(readAdmissionForm(null)).toEqual(defaultAdmissionForm());
    expect(readAdmissionForm({ builtins: { gender: { enabled: false } } }).builtins.gender.enabled).toBe(false);
  });

  it('reports every field error in one response', () => {
    expect(() => throwFieldErrors({})).not.toThrow();
    try {
      throwFieldErrors({ a: 'x', b: 'y' });
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ message: 'Please correct 2 fields in the form', fieldErrors: { a: 'x', b: 'y' } });
    }
  });
});

describe('saving answers to the student record', () => {
  const dto = (fields: AdmissionFormDto['fields']): AdmissionFormDto => ({ intro: null, builtins: defaultAdmissionForm().builtins, fields });

  it('only links fields whose type fits, once per student detail', () => {
    expect(() => cleanAdmissionForm(dto([{ id: 'a', type: 'number', label: 'CNIC', section: 'guardian', required: false, saveTo: 'guardian.nationalId' }]), [])).toThrow(/matching type/);
    expect(() => cleanAdmissionForm(dto([
      { id: 'a', type: 'text', label: 'A', section: 'student', required: false, saveTo: 'student.religion' },
      { id: 'b', type: 'select', label: 'B', section: 'student', required: false, options: ['Islam'], saveTo: 'student.religion' },
    ]), [])).toThrow(/same student detail/);
    expect(() => cleanAdmissionForm(dto([{ id: 'bg', type: 'select', label: 'Blood', section: 'student', required: false, options: ['A+', 'Unknown'], saveTo: 'student.bloodGroup' }]), [])).toThrow(/blood group/);
    const [f] = cleanAdmissionForm(dto([{ id: 'id', type: 'text', label: 'B-Form', section: 'student', required: true, maxLength: 200, saveTo: 'student.nationalId' }]), []).fields;
    expect(f!.maxLength).toBe(40); // the column's limit
  });

  it('checks and normalises a blood group typed by hand', () => {
    const f = form([field({ id: 'bg', type: 'text', saveTo: 'student.bloodGroup' })], (x) => { x.builtins.photo.required = false; });
    expect(checkApplication(f, CLASS_1, {}, { bg: 'Z' }).errors).toEqual({ bg: 'Enter a blood group like A+, B-, AB+ or O-' });
    expect(checkApplication(f, CLASS_1, {}, { bg: 'ab+' }).answers[0]!.value).toBe('AB+');
  });

  it('stores each answer in its typed column and reads it back unchanged', () => {
    const answers = [
      { fieldId: 'n', label: 'N', type: 'number', section: 'additional', saveTo: null, value: 3 },
      { fieldId: 'd', label: 'D', type: 'date', section: 'student', saveTo: 'previousSchool.leftOn', value: '2026-03-31' },
      { fieldId: 'm', label: 'M', type: 'multiselect', section: 'additional', saveTo: null, value: ['A', 'B'] },
      { fieldId: 'c', label: 'C', type: 'checkbox', section: 'additional', saveTo: null, value: true },
      { fieldId: 'f', label: 'F', type: 'file', section: 'documents', saveTo: null, value: { documentId: FILE, fileName: 'bform.pdf' } },
      { fieldId: 't', label: 'T', type: 'text', section: 'guardian', saveTo: 'guardian.nationalId', value: '35202-1234567-1' },
    ] as const;
    const rows = answers.map((a, i) => answerRow(a as never, i));
    expect(rows[0]).toMatchObject({ valueNumber: 3, valueText: null });
    expect(rows[1]!.valueDate).toEqual(new Date('2026-03-31T00:00:00Z'));
    expect(rows[4]).toMatchObject({ documentId: FILE, valueText: 'bform.pdf' });
    expect(rows.map(answerOf)).toEqual(answers);
    expect(savedValues(rows.map(answerOf))).toEqual({ 'previousSchool.leftOn': '2026-03-31', 'guardian.nationalId': '35202-1234567-1' });
  });
});
