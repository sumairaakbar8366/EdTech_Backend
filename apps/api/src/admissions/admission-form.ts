import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/**
 * Each school designs its own online admission form: it shows, hides, renames or requires the
 * optional standard fields and adds fields of its own (with limits and a class filter). The core
 * fields that enrollment needs (class, campus, the child's name and date of birth, the parent's
 * name, relationship and phone) are always asked.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const FIELD_TYPES = ['text', 'textarea', 'number', 'email', 'phone', 'date', 'select', 'multiselect', 'checkbox', 'file'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FORM_SECTIONS = ['student', 'guardian', 'additional', 'documents'] as const;
export type FormSection = (typeof FORM_SECTIONS)[number];
/** Standard fields the school may hide, rename or make required. */
export const OPTIONAL_BUILTINS = ['photo', 'gender', 'previousSchool', 'guardianEmail', 'address', 'notes'] as const;
export type OptionalBuiltin = (typeof OPTIONAL_BUILTINS)[number];

const MAX_FIELDS = 60;
const MAX_OPTIONS = 50;
/** Longest answer a field may allow (and the default when the school sets no limit). */
const TEXT_LIMIT = { text: 200, textarea: 3000 } as const;

const TEXTISH: readonly FieldType[] = ['text', 'textarea', 'select'];
/**
 * Student-record columns a field's answer can be saved to when the applicant is enrolled, with the
 * answer types that fit and the column's length limit.
 */
export const SAVE_TARGETS = {
  'student.nationalId': { types: ['text'], max: 40 },
  'student.bloodGroup': { types: ['select', 'text'], max: 3 },
  'student.religion': { types: TEXTISH, max: 60 },
  'student.nationality': { types: TEXTISH, max: 60 },
  'guardian.occupation': { types: TEXTISH, max: 100 },
  'guardian.nationalId': { types: ['text'], max: 40 },
  'medical.allergies': { types: TEXTISH, max: 1000 },
  'medical.conditions': { types: TEXTISH, max: 1000 },
  'medical.medications': { types: TEXTISH, max: 1000 },
  'medical.doctorName': { types: ['text'], max: 120 },
  'medical.doctorPhone': { types: ['phone', 'text'], max: 32 },
  'emergency.name': { types: ['text'], max: 120 },
  'emergency.relationship': { types: TEXTISH, max: 60 },
  'emergency.phone': { types: ['phone', 'text'], max: 32 },
  'previousSchool.lastClass': { types: TEXTISH, max: 60 },
  'previousSchool.leftOn': { types: ['date'], max: 10 },
  'previousSchool.reason': { types: TEXTISH, max: 500 },
} as const satisfies Record<string, { types: readonly FieldType[]; max: number }>;
export type SaveTarget = keyof typeof SAVE_TARGETS;
const BLOOD_GROUP = /^(A|B|AB|O)[+-]$/;

export interface BuiltinSetting { enabled: boolean; required: boolean; label: string | null }
export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  section: FormSection;
  help: string | null;
  required: boolean;
  /** select / multiselect */
  options: string[];
  /** text / textarea */
  minLength: number | null;
  maxLength: number | null;
  /** number */
  min: number | null;
  max: number | null;
  /** Asked only for these classes; empty = every class. */
  classIds: string[];
  /** Copied to this student-record column on enrollment. */
  saveTo: SaveTarget | null;
}
export interface AdmissionForm {
  intro: string | null;
  builtins: Record<OptionalBuiltin, BuiltinSetting>;
  fields: FormField[];
}

/** One answer as stored on the application: the field's label is kept so later form edits do not change it. */
export interface FormAnswer {
  fieldId: string;
  label: string;
  type: FieldType;
  section: FormSection;
  saveTo: SaveTarget | null;
  value: string | number | boolean | string[] | { documentId: string; fileName: string };
}

/** The form a school has before it changes anything: what the website asked so far. */
export function defaultAdmissionForm(): AdmissionForm {
  const optional = { enabled: true, required: false, label: null };
  return {
    intro: null,
    builtins: { photo: { enabled: true, required: true, label: null }, gender: optional, previousSchool: optional, guardianEmail: optional, address: optional, notes: optional },
    fields: [],
  };
}

/** The stored form (JSON; null before the first save), completed with defaults for anything missing. */
export function readAdmissionForm(raw: unknown): AdmissionForm {
  const base = defaultAdmissionForm();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AdmissionForm>;
  const builtins = { ...base.builtins };
  for (const k of OPTIONAL_BUILTINS) if (r.builtins?.[k]) builtins[k] = { ...base.builtins[k], ...r.builtins[k] };
  return { intro: r.intro ?? null, builtins, fields: Array.isArray(r.fields) ? r.fields.map((f) => ({ ...f, saveTo: f.saveTo ?? null })) : [] };
}

// --- Saving the form (admin) ---------------------------------------------------------------

export class BuiltinSettingDto {
  @IsBoolean() enabled: boolean;
  @IsBoolean() required: boolean;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(120) label?: string | null;
}

export class BuiltinsDto {
  @ValidateNested() @Type(() => BuiltinSettingDto) photo: BuiltinSettingDto;
  @ValidateNested() @Type(() => BuiltinSettingDto) gender: BuiltinSettingDto;
  @ValidateNested() @Type(() => BuiltinSettingDto) previousSchool: BuiltinSettingDto;
  @ValidateNested() @Type(() => BuiltinSettingDto) guardianEmail: BuiltinSettingDto;
  @ValidateNested() @Type(() => BuiltinSettingDto) address: BuiltinSettingDto;
  @ValidateNested() @Type(() => BuiltinSettingDto) notes: BuiltinSettingDto;
}

export class FormFieldDto {
  @Matches(/^[a-z0-9_-]{1,40}$/, { message: 'Field ids are short lowercase keys' }) id: string;
  @IsIn(FIELD_TYPES) type: FieldType;
  @Transform(trim) @IsString() @IsNotEmpty({ message: 'Every field needs a label' }) @MaxLength(120) label: string;
  @IsIn(FORM_SECTIONS) section: FormSection;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(300) help?: string | null;
  @IsBoolean() required: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_OPTIONS) @IsString({ each: true }) @MaxLength(100, { each: true }) options?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(TEXT_LIMIT.textarea) minLength?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(TEXT_LIMIT.textarea) maxLength?: number | null;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) min?: number | null;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) max?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) classIds?: string[];
  @IsOptional() @IsIn(Object.keys(SAVE_TARGETS)) saveTo?: SaveTarget | null;
}

export class AdmissionFormDto {
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(3000) intro?: string | null;
  @ValidateNested() @Type(() => BuiltinsDto) builtins: BuiltinsDto;
  @IsArray() @ArrayMaxSize(MAX_FIELDS) @ValidateNested({ each: true }) @Type(() => FormFieldDto) fields: FormFieldDto[];
}

/** Checks what the DTO cannot (unique ids, options, limits, classes) and keeps only what each type uses. */
export function cleanAdmissionForm(dto: AdmissionFormDto, schoolClassIds: readonly string[]): AdmissionForm {
  const known = new Set(schoolClassIds);
  const ids = new Set<string>();
  const targets = new Set<SaveTarget>();
  const fields = dto.fields.map((f): FormField => {
    const name = `“${f.label}”`;
    if (ids.has(f.id)) throw new BadRequestException(`Two fields share the id "${f.id}"`);
    ids.add(f.id);
    const options = [...new Set((f.options ?? []).map((o) => (f.saveTo === 'student.bloodGroup' ? o.trim().toUpperCase() : o.trim())).filter(Boolean))];
    if ((f.type === 'select' || f.type === 'multiselect') && options.length < 1) throw new BadRequestException(`${name} needs at least one choice`);
    const saveTo = f.saveTo ?? null;
    const target = saveTo ? SAVE_TARGETS[saveTo] : null;
    if (saveTo && target) {
      if (!(target.types as readonly FieldType[]).includes(f.type)) throw new BadRequestException(`${name} cannot be saved to that student detail: choose a matching type of answer`);
      if (targets.has(saveTo)) throw new BadRequestException(`Two fields are saved to the same student detail; ${name} is one of them`);
      targets.add(saveTo);
      if (saveTo === 'student.bloodGroup' && f.type === 'select' && options.some((o) => !BLOOD_GROUP.test(o))) throw new BadRequestException(`${name}: blood group choices must be like A+, B-, AB+ or O-`);
      if (options.some((o) => o.length > target.max)) throw new BadRequestException(`${name}: each choice can be at most ${target.max} characters for that student detail`);
    }
    const isText = f.type === 'text' || f.type === 'textarea';
    const minLength = isText ? f.minLength ?? null : null;
    const maxLength = isText ? Math.min(f.maxLength ?? TEXT_LIMIT[f.type as 'text'], TEXT_LIMIT[f.type as 'text'], target?.max ?? Infinity) : null;
    if (minLength !== null && maxLength !== null && minLength > maxLength) throw new BadRequestException(`${name}: the shortest answer is longer than the longest`);
    const min = f.type === 'number' ? f.min ?? null : null;
    const max = f.type === 'number' ? f.max ?? null : null;
    if (min !== null && max !== null && min > max) throw new BadRequestException(`${name}: the smallest number is bigger than the largest`);
    const classIds = [...new Set(f.classIds ?? [])];
    if (classIds.some((c) => !known.has(c))) throw new BadRequestException(`${name} is limited to a class that no longer exists; choose the classes again`);
    return {
      id: f.id,
      type: f.type,
      label: f.label,
      section: f.type === 'file' ? 'documents' : f.section === 'documents' ? 'additional' : f.section,
      help: f.help ?? null,
      required: f.required,
      options: f.type === 'select' || f.type === 'multiselect' ? options : [],
      minLength,
      maxLength,
      min,
      max,
      classIds,
      saveTo,
    };
  });
  const builtins = {} as Record<OptionalBuiltin, BuiltinSetting>;
  for (const k of OPTIONAL_BUILTINS) {
    const b = dto.builtins[k];
    // A hidden field cannot be required.
    builtins[k] = { enabled: b.enabled, required: b.enabled && b.required, label: b.label ?? null };
  }
  return { intro: dto.intro ?? null, builtins, fields };
}

// --- Checking an application (website) -------------------------------------------------------

/** The school's fields that apply to an applicant for this class. */
export const fieldsForClass = (form: AdmissionForm, classId: string) => form.fields.filter((f) => !f.classIds.length || f.classIds.includes(classId));

/** The standard optional values an application may carry, as sent by the website. */
export interface BuiltinValues {
  photoId?: string | null;
  gender?: string | null;
  previousSchool?: string | null;
  guardianEmail?: string | null;
  address?: string | null;
  notes?: string | null;
}

const BUILTIN_VALUE: Record<OptionalBuiltin, keyof BuiltinValues> = { photo: 'photoId', gender: 'gender', previousSchool: 'previousSchool', guardianEmail: 'guardianEmail', address: 'address', notes: 'notes' };
const BUILTIN_LABEL: Record<OptionalBuiltin, string> = { photo: "Student's photo", gender: 'Gender', previousSchool: 'Previous school', guardianEmail: 'Email', address: 'Address', notes: 'Notes' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{7,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

function validDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 1900 && d.getUTCFullYear() <= 2100;
}

export interface CheckedApplication {
  /** Answers to the school's own fields; file answers still hold the staged file id. */
  answers: FormAnswer[];
  /** File fields and the staged upload each one points to. */
  files: { fieldId: string; label: string; fileId: string }[];
  /** Hidden standard fields: their values are dropped. */
  hidden: (keyof BuiltinValues)[];
  /** Messages by field (the school's field id, or the standard field's key). */
  errors: Record<string, string>;
}

/**
 * Checks an application against the school's form: required fields, types, limits, choices and the
 * class filter. Unknown answers are rejected; answers to fields not asked for this class are refused.
 */
export function checkApplication(form: AdmissionForm, classId: string, values: BuiltinValues, rawAnswers: unknown): CheckedApplication {
  const errors: Record<string, string> = {};
  const hidden: (keyof BuiltinValues)[] = [];
  for (const k of OPTIONAL_BUILTINS) {
    const b = form.builtins[k];
    const key = BUILTIN_VALUE[k];
    if (!b.enabled) hidden.push(key);
    else if (b.required && isEmpty(values[key])) errors[key] = `${b.label ?? BUILTIN_LABEL[k]} is required`;
  }

  const answers: FormAnswer[] = [];
  const files: CheckedApplication['files'] = [];
  if (rawAnswers !== undefined && rawAnswers !== null && (typeof rawAnswers !== 'object' || Array.isArray(rawAnswers))) {
    return { answers, files, hidden, errors: { ...errors, answers: 'The form answers could not be read' } };
  }
  const given = (rawAnswers ?? {}) as Record<string, unknown>;
  const asked = fieldsForClass(form, classId);
  const askedIds = new Set(asked.map((f) => f.id));
  for (const id of Object.keys(given)) {
    if (askedIds.has(id) || isEmpty(given[id])) continue;
    errors[id] = form.fields.some((f) => f.id === id) ? 'This question is not asked for the chosen class' : 'Unknown question';
  }

  for (const f of asked) {
    const v = given[f.id];
    const fail = (message: string) => { errors[f.id] = message; };
    if (isEmpty(v) || (f.type === 'checkbox' && v === false)) {
      if (f.required) fail(f.type === 'checkbox' ? 'Please tick this box' : f.type === 'file' ? 'Please attach this document' : 'This field is required');
      continue;
    }
    const keep = (value: FormAnswer['value']) => answers.push({ fieldId: f.id, label: f.label, type: f.type, section: f.section, saveTo: f.saveTo, value });
    switch (f.type) {
      case 'text':
      case 'textarea': {
        if (typeof v !== 'string') { fail('Enter text'); break; }
        // One-line answers are kept without doubled spaces; paragraphs keep their line breaks.
        const s = f.type === 'text' ? v.trim().replace(/\s+/g, ' ') : v.trim().replace(/[ \t]+\n/g, '\n');
        if (f.minLength !== null && s.length < f.minLength) { fail(`Enter at least ${f.minLength} characters`); break; }
        if (s.length > (f.maxLength ?? TEXT_LIMIT[f.type])) { fail(`Enter at most ${f.maxLength ?? TEXT_LIMIT[f.type]} characters`); break; }
        if (f.saveTo === 'student.bloodGroup') {
          if (!BLOOD_GROUP.test(s.toUpperCase())) { fail('Enter a blood group like A+, B-, AB+ or O-'); break; }
          keep(s.toUpperCase());
          break;
        }
        keep(s);
        break;
      }
      case 'number': {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
        if (!Number.isFinite(n)) { fail('Enter a number'); break; }
        if (f.min !== null && n < f.min) { fail(`Enter ${f.min} or more`); break; }
        if (f.max !== null && n > f.max) { fail(`Enter ${f.max} or less`); break; }
        keep(n);
        break;
      }
      case 'email': {
        const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
        if (!EMAIL.test(s) || s.length > 254) { fail('Enter a valid email address'); break; }
        keep(s);
        break;
      }
      case 'phone': {
        const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
        if (!PHONE.test(s) || s.replace(/\D/g, '').length < 7) { fail('Enter a valid phone number, e.g. 0300 1234567'); break; }
        keep(s);
        break;
      }
      case 'date': {
        if (typeof v !== 'string' || !validDate(v)) { fail('Enter a valid date'); break; }
        keep(v);
        break;
      }
      case 'select': {
        if (typeof v !== 'string' || !f.options.includes(v)) { fail('Choose one of the options'); break; }
        keep(v);
        break;
      }
      case 'multiselect': {
        const list = Array.isArray(v) ? v : [];
        if (!list.length || list.some((x) => typeof x !== 'string' || !f.options.includes(x))) { fail('Choose from the options given'); break; }
        keep([...new Set(list as string[])]);
        break;
      }
      case 'checkbox': {
        if (v !== true) { fail('Tick the box or leave it empty'); break; }
        keep(true);
        break;
      }
      case 'file': {
        if (typeof v !== 'string' || !UUID.test(v)) { fail('Attach the document again'); break; }
        if (files.some((x) => x.fileId === v)) { fail('This file is already attached to another question'); break; }
        files.push({ fieldId: f.id, label: f.label, fileId: v });
        break;
      }
    }
  }
  return { answers, files, hidden, errors };
}

/** Rejects the request with every problem at once; the website shows each message at its field. */
export function throwFieldErrors(errors: Record<string, string>): void {
  const messages = Object.values(errors);
  if (!messages.length) return;
  throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: messages.length === 1 ? messages[0] : `Please correct ${messages.length} fields in the form`, fieldErrors: errors });
}

// --- Storing answers ---------------------------------------------------------------------------

/** An answer as a row of admission_answers: each kind of value in its own typed column. */
export function answerRow(a: FormAnswer, position: number) {
  const v = a.value;
  return {
    fieldId: a.fieldId,
    position,
    label: a.label,
    type: a.type,
    section: a.section,
    saveTo: a.saveTo,
    valueText: typeof v === 'string' && a.type !== 'date' ? v : typeof v === 'object' && !Array.isArray(v) ? v.fileName : null,
    valueNumber: typeof v === 'number' ? v : null,
    valueDate: a.type === 'date' && typeof v === 'string' ? new Date(`${v}T00:00:00Z`) : null,
    valueBool: typeof v === 'boolean' ? v : null,
    valueList: Array.isArray(v) ? v : [],
    documentId: typeof v === 'object' && !Array.isArray(v) ? v.documentId : null,
  };
}

export interface AnswerRow {
  fieldId: string;
  label: string;
  type: string;
  section: string;
  saveTo: string | null;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueBool: boolean | null;
  valueList: string[];
  documentId: string | null;
}

/** A stored row back as an answer (what the API returns). */
export function answerOf(r: AnswerRow): FormAnswer {
  const value: FormAnswer['value'] =
    r.documentId ? { documentId: r.documentId, fileName: r.valueText ?? 'file' }
    : r.valueDate ? r.valueDate.toISOString().slice(0, 10)
    : r.valueNumber !== null ? r.valueNumber
    : r.valueBool !== null ? r.valueBool
    : r.type === 'multiselect' ? r.valueList
    : r.valueText ?? '';
  return { fieldId: r.fieldId, label: r.label, type: r.type as FieldType, section: r.section as FormSection, saveTo: r.saveTo as SaveTarget | null, value };
}

/** The answers that enrollment copies to the student record, by target. */
export function savedValues(answers: FormAnswer[]): Partial<Record<SaveTarget, string>> {
  const out: Partial<Record<SaveTarget, string>> = {};
  for (const a of answers) {
    if (!a.saveTo || !(a.saveTo in SAVE_TARGETS)) continue;
    const v = a.value;
    const text = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
    if (text) out[a.saveTo] = text.slice(0, SAVE_TARGETS[a.saveTo].max);
  }
  return out;
}
