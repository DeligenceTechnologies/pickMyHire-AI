import "server-only";
import { json, withOrg, type Tx } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import type { TemplateInput } from "@/types/interview";
import { getPricing } from "./pricing";

export type TemplateSectionRow = {
  id: string;
  template_id: string;
  name: string;
  description: string;
  objective: string;
  instructions: string;
  duration_minutes: number;
  min_questions: number;
  max_questions: number;
  max_followups: number;
  evaluation_criteria: string[];
  scoring_enabled: boolean;
  sort_order: number;
  enabled: boolean;
};

export type TemplateRow = {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
};

export async function insertTemplate(tx: Tx, orgId: string, userId: string | null, input: TemplateInput, isDefault = false): Promise<string> {
  const [t] = await tx<{ id: string }[]>`
    insert into interview_templates (organization_id, name, description, is_default, created_by)
    values (${orgId}, ${input.name}, ${input.description}, ${isDefault}, ${userId}) returning id`;
  await insertSections(tx, orgId, t.id, input);
  return t.id;
}

async function insertSections(tx: Tx, orgId: string, templateId: string, input: TemplateInput) {
  let order = 0;
  for (const s of input.sections) {
    await tx`
      insert into interview_template_sections
        (organization_id, template_id, name, description, objective, instructions, duration_minutes,
         min_questions, max_questions, max_followups, evaluation_criteria, scoring_enabled, sort_order, enabled)
      values (${orgId}, ${templateId}, ${s.name}, ${s.description}, ${s.objective}, ${s.instructions}, ${s.duration_minutes},
              ${s.min_questions}, ${s.max_questions}, ${s.max_followups}, ${json(s.evaluation_criteria)}, ${s.scoring_enabled},
              ${order++}, ${s.enabled})`;
  }
}

export async function listTemplates(orgId: string) {
  return withOrg(orgId, (tx) => tx<(TemplateRow & { section_count: number; total_minutes: number; job_count: number })[]>`
    select t.id, t.name, t.description, t.is_default, t.created_at, t.updated_at,
      (select count(*)::int from interview_template_sections s where s.template_id = t.id and s.enabled) as section_count,
      (select coalesce(sum(duration_minutes), 0)::int from interview_template_sections s where s.template_id = t.id and s.enabled) as total_minutes,
      (select count(distinct r.job_id)::int from job_rounds r where r.template_id = t.id) as job_count
    from interview_templates t where t.organization_id = ${orgId}
    order by t.is_default desc, t.created_at desc`);
}

export async function getTemplate(orgId: string, templateId: string) {
  return withOrg(orgId, async (tx) => {
    const [t] = await tx<TemplateRow[]>`select id, name, description, is_default, created_at, updated_at from interview_templates where id = ${templateId} and organization_id = ${orgId}`;
    if (!t) return null;
    const sections = await tx<TemplateSectionRow[]>`
      select * from interview_template_sections where template_id = ${templateId} order by sort_order`;
    return { ...t, sections };
  });
}

/** Templates can't be longer than the longest interview allowed by pricing. */
async function assertLength(input: TemplateInput) {
  const minutes = input.sections.filter((s) => s.enabled).reduce((a, s) => a + s.duration_minutes, 0);
  const { maxMinutes } = await getPricing();
  if (minutes > maxMinutes) throw new ApiError(400, `Interviews can be up to ${maxMinutes} minutes. This template is ${minutes} minutes: shorten some sections.`);
}

export async function createTemplate(orgId: string, userId: string, input: TemplateInput) {
  await assertLength(input);
  return withOrg(orgId, async (tx) => {
    const id = await insertTemplate(tx, orgId, userId, input);
    await audit(tx, { orgId, userId, action: "template.created", entityType: "template", entityId: id });
    return id;
  });
}

/**
 * Update a template. Sections are replaced; existing interviews keep their own
 * copy of section config inside interview_plan, so edits never alter past interviews.
 */
export async function updateTemplate(orgId: string, userId: string, templateId: string, input: TemplateInput) {
  await assertLength(input);
  return withOrg(orgId, async (tx) => {
    const [t] = await tx`update interview_templates set name = ${input.name}, description = ${input.description}
      where id = ${templateId} and organization_id = ${orgId} returning id`;
    if (!t) throw new ApiError(404, "Template not found");
    await tx`delete from interview_template_sections where template_id = ${templateId}`;
    await insertSections(tx, orgId, templateId, input);
    await audit(tx, { orgId, userId, action: "template.updated", entityType: "template", entityId: templateId });
  });
}

export async function deleteTemplate(orgId: string, userId: string, templateId: string) {
  return withOrg(orgId, async (tx) => {
    const [{ count }] = await tx<{ count: number }[]>`
      select count(distinct j.id)::int as count from job_rounds r join jobs j on j.id = r.job_id
      where r.template_id = ${templateId} and j.status in ('active','draft','paused')`;
    if (count > 0) throw new ApiError(409, "This template is used by an interview round of an open job. Choose another template for that round first.");
    await tx`delete from interview_templates where id = ${templateId} and organization_id = ${orgId}`;
    await audit(tx, { orgId, userId, action: "template.deleted", entityType: "template", entityId: templateId });
  });
}
