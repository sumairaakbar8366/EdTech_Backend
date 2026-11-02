import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/**
 * A form somebody can design: the platform owner (new-school registration, scholarship request) or a
 * school's admin / principal (teacher, staff, student, parent and access forms). The fields the system
 * itself needs are built in and always asked; the form adds fields of its own on top of them.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'email', 'phone', 'date', 'select', 'multiselect', 'checkbox', 'file'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const MAX_CUSTOM_FIELDS = 60;
const MAX_OPTIONS = 50;
export const TEXT_LIMIT = { text: 200, textarea: 3000 } as const;

export interface CustomField {
  id: string;
  type: CustomFieldType;
  label: string;
  /** The heading it appears under on the form and the profile ("Personal", "Documents"…). */
  section: string | null;
  help: string | null;
  required: boolean;
  options: string[];
  minLength: number | null;
  maxLength: number | null;
  min: number | null;
  max: number | null;
}

export interface CustomForm {
  intro: string | null;
  fields: CustomField[];
}

/** A document answer: the file was uploaded to the person's documents. */
export interface FileAnswer { documentId: string; fileName: string }
export type AnswerValue = string | number | boolean | string[] | FileAnswer;
export type Answers = Record<string, AnswerValue>;

export const emptyForm = (): CustomForm => ({ intro: null, fields: [] });

/** The stored form (JSON), completed with defaults for anything missing. Never throws. */
export function readCustomForm(raw: unknown): CustomForm {
  if (!raw || typeof raw !== 'object') return emptyForm();
  const r = raw as Partial<CustomForm>;
  const fields = Array.isArray(r.fields) ? r.fields.filter((f): f is CustomField => !!f && typeof f.id === 'string' && (CUSTOM_FIELD_TYPES as readonly string[]).includes(f.type)) : [];
  return { intro: typeof r.intro === 'string' ? r.intro : null, fields: fields.map((f) => ({ ...f, section: f.section ?? null, help: f.help ?? null, options: f.options ?? [], minLength: f.minLength ?? null, maxLength: f.maxLength ?? null, min: f.min ?? null, max: f.max ?? null })) };
}

// --- Saving a form (the designer) ----------------------------------------------------------

export class CustomFieldDto {
  @Matches(/^[a-z0-9_-]{1,40}$/, { message: 'Field ids are short lowercase keys' }) id: string;
  @IsIn(CUSTOM_FIELD_TYPES) type: CustomFieldType;
  @Transform(trim) @IsString() @IsNotEmpty({ message: 'Every field needs a label' }) @MaxLength(120) label: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(40) section?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(300) help?: string | null;
  @IsBoolean() required: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_OPTIONS) @IsString({ each: true }) @MaxLength(100, { each: true }) options?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(TEXT_LIMIT.textarea) minLength?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(TEXT_LIMIT.textarea) maxLength?: number | null;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) min?: number | null;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) max?: number | null;
}

export class CustomFormDto {
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(3000) intro?: string | null;
  @IsArray() @ArrayMaxSize(MAX_CUSTOM_FIELDS) @ValidateNested({ each: true }) @Type(() => CustomFieldDto) fields: CustomFieldDto[];
}

/** Checks what the DTO cannot (unique ids, choices, limits) and keeps only what each type uses. */
export function cleanCustomForm(dto: CustomFormDto, reservedIds: readonly string[] = [], allowFiles = false): CustomForm {
  const ids = new Set<string>(reservedIds);
  const fields = dto.fields.map((f): CustomField => {
    const name = `“${f.label}”`;
    if (ids.has(f.id)) throw new BadRequestException(`The id "${f.id}" is used twice or is reserved`);
    ids.add(f.id);
    if (f.type === 'file' && !allowFiles) throw new BadRequestException(`${name}: document uploads are not available on this form`);
    const options = [...new Set((f.options ?? []).map((o) => o.trim()).filter(Boolean))];
    const choice = f.type === 'select' || f.type === 'multiselect';
    if (choice && options.length < 1) throw new BadRequestException(`${name} needs at least one choice`);
    const isText = f.type === 'text' || f.type === 'textarea';
    const minLength = isText ? f.minLength ?? null : null;
    const maxLength = isText ? Math.min(f.maxLength ?? TEXT_LIMIT[f.type as 'text'], TEXT_LIMIT[f.type as 'text']) : null;
    if (minLength !== null && maxLength !== null && minLength > maxLength) throw new BadRequestException(`${name}: the shortest answer is longer than the longest`);
    const min = f.type === 'number' ? f.min ?? null : null;
    const max = f.type === 'number' ? f.max ?? null : null;
    if (min !== null && max !== null && min > max) throw new BadRequestException(`${name}: the smallest number is bigger than the largest`);
    return { id: f.id, type: f.type, label: f.label, section: f.type === 'file' ? 'Documents' : f.section ?? null, help: f.help ?? null, required: f.required, options: choice ? options : [], minLength, maxLength, min, max };
  });
  return { intro: dto.intro ?? null, fields };
}

// --- Answering a form ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+0-9][0-9 ()-]{6,24}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AnswerCheck {
  answers: Answers;
  /** field id → what is wrong */
  errors: Record<string, string>;
}

/** Validates the answers against the form; unknown ids are dropped and empty optional ones skipped. */
export function checkAnswers(form: CustomForm, given: unknown): AnswerCheck {
  const input = given && typeof given === 'object' && !Array.isArray(given) ? (given as Record<string, unknown>) : {};
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  for (const f of form.fields) {
    const v = input[f.id];
    const empty = v === undefined || v === null || v === '' || (f.type === 'file' && typeof v !== 'object') || (Array.isArray(v) && v.length === 0) || (f.type === 'checkbox' && v === false);
    if (empty) {
      if (f.required) errors[f.id] = `${f.label} is required`;
      continue;
    }
    switch (f.type) {
      case 'text':
      case 'textarea': {
        if (typeof v !== 'string') { errors[f.id] = `${f.label} must be text`; break; }
        const t = v.trim();
        if (f.minLength !== null && t.length < f.minLength) errors[f.id] = `${f.label} must be at least ${f.minLength} characters`;
        else if (t.length > (f.maxLength ?? TEXT_LIMIT[f.type])) errors[f.id] = `${f.label} must be at most ${f.maxLength ?? TEXT_LIMIT[f.type]} characters`;
        else answers[f.id] = t;
        break;
      }
      case 'number': {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
        if (!Number.isFinite(n)) errors[f.id] = `${f.label} must be a number`;
        else if (f.min !== null && n < f.min) errors[f.id] = `${f.label} must be at least ${f.min}`;
        else if (f.max !== null && n > f.max) errors[f.id] = `${f.label} must be at most ${f.max}`;
        else answers[f.id] = n;
        break;
      }
      case 'email':
        if (typeof v !== 'string' || !EMAIL.test(v.trim())) errors[f.id] = `${f.label} must be an email address`;
        else answers[f.id] = v.trim().toLowerCase();
        break;
      case 'phone':
        if (typeof v !== 'string' || !PHONE.test(v.trim())) errors[f.id] = `${f.label} must be a phone number`;
        else answers[f.id] = v.trim();
        break;
      case 'date':
        if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(v))) errors[f.id] = `${f.label} must be a date`;
        else answers[f.id] = v;
        break;
      case 'select':
        if (typeof v !== 'string' || !f.options.includes(v)) errors[f.id] = `${f.label}: choose one of the listed options`;
        else answers[f.id] = v;
        break;
      case 'multiselect':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !f.options.includes(x))) errors[f.id] = `${f.label}: choose from the listed options`;
        else answers[f.id] = [...new Set(v as string[])];
        break;
      case 'file': {
        const o = v as Partial<FileAnswer>;
        if (typeof o !== 'object' || typeof o.documentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(o.documentId) || typeof o.fileName !== 'string') errors[f.id] = `${f.label}: attach the document`;
        else answers[f.id] = { documentId: o.documentId, fileName: o.fileName.slice(0, 150) };
        break;
      }
      case 'checkbox':
        if (typeof v !== 'boolean') errors[f.id] = `${f.label} must be yes or no`;
        else answers[f.id] = v;
        break;
    }
  }
  return { answers, errors };
}

/** Throws one readable 400 listing every wrong answer. */
export function assertAnswers(form: CustomForm, given: unknown): Answers {
  const { answers, errors } = checkAnswers(form, given);
  const bad = Object.values(errors);
  if (bad.length) throw new BadRequestException({ message: bad.join('. '), fieldErrors: errors });
  return answers;
}
