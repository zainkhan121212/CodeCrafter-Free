import { courses } from './catalog.mjs';
export function validateReport(value) {
  if(!value||value.schemaVersion!==1||typeof value.id!=='string'||value.id.length>100||
    typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!Array.isArray(value.results))return false;
  const course=courses.find(c=>c.id===value.challenge);
  if(!course||value.results.length===0||value.results.length>course.stages.length)return false;
  const ids=new Set();
  for(const r of value.results) {
    if(!r||!course.stages.some(s=>s.id===r.id)||ids.has(r.id)||typeof r.passed!=='boolean'||
      !Array.isArray(r.checks)||!r.checks.length||r.checks.length>100)return false;
    ids.add(r.id);
    if(r.checks.some(c=>!c||typeof c.name!=='string'||typeof c.passed!=='boolean'))return false;
    if(r.passed!==r.checks.every(c=>c.passed))return false;
  }
  return value.passed===value.results.every(r=>r.passed);
}
