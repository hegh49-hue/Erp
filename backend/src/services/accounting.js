const { ApiError } = require('../middleware/asyncHandler');

const EPSILON = 0.005;

/**
 * Posts a balanced double-entry journal entry inside an existing DB transaction.
 * Enforces: >=2 lines, debits==credits, and that any line touching a
 * has_subledger account carries an entity_id belonging to that control account
 * (the "analytical element" invariant from the spec).
 */
async function postJournalEntry(client, { entryDate, description, reference, sourceType, sourceId, createdBy, lines }) {
  if (!entryDate || !description) throw new ApiError(400, 'التاريخ وبيان القيد مطلوبان');
  if (!Array.isArray(lines) || lines.length < 2) throw new ApiError(400, 'يجب أن يحتوي القيد على سطرين على الأقل');

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const { rows: accounts } = await client.query(
    `SELECT id, code, name, has_subledger, subledger_type FROM accounts WHERE id = ANY($1::uuid[])`,
    [accountIds]
  );
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  let sumDebit = 0;
  let sumCredit = 0;
  for (const line of lines) {
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    if (debit < 0 || credit < 0) throw new ApiError(400, 'المبالغ يجب أن تكون موجبة');
    if (debit > 0 && credit > 0) throw new ApiError(400, 'لا يمكن أن يحمل السطر مدين ودائن معاً');
    if (debit === 0 && credit === 0) continue;
    const account = accountsById.get(line.accountId);
    if (!account) throw new ApiError(400, 'حساب غير موجود ضمن القيد');
    if (account.has_subledger && !line.entityId) {
      throw new ApiError(400, `الحساب "${account.name}" إجمالي ويتطلب تحديد عنصر تحليلي`);
    }
    sumDebit += debit;
    sumCredit += credit;
  }
  if (sumDebit <= 0 || Math.abs(sumDebit - sumCredit) > EPSILON) {
    throw new ApiError(400, 'القيد غير متوازن — مجموع المدين يجب أن يساوي مجموع الدائن');
  }

  // Validate entity_id actually belongs to the referenced control account.
  const entityIds = [...new Set(lines.map((l) => l.entityId).filter(Boolean))];
  if (entityIds.length) {
    const { rows: entities } = await client.query(
      `SELECT id, control_account_id FROM subledger_entities WHERE id = ANY($1::uuid[])`,
      [entityIds]
    );
    const entityById = new Map(entities.map((e) => [e.id, e]));
    for (const line of lines) {
      if (!line.entityId) continue;
      const entity = entityById.get(line.entityId);
      if (!entity || entity.control_account_id !== line.accountId) {
        throw new ApiError(400, 'العنصر التحليلي لا يتبع الحساب الإجمالي المحدد لهذا السطر');
      }
    }
  }

  const { rows: entryRows } = await client.query(
    `INSERT INTO journal_entries (entry_date, description, reference, source_type, source_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [entryDate, description, reference || null, sourceType || 'manual', sourceId || null, createdBy || null]
  );
  const entry = entryRows[0];

  let lineNo = 1;
  const insertedLines = [];
  for (const line of lines) {
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    if (debit === 0 && credit === 0) continue;
    const { rows } = await client.query(
      `INSERT INTO journal_lines (entry_id, line_no, account_id, entity_id, debit, credit)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [entry.id, lineNo++, line.accountId, line.entityId || null, debit, credit]
    );
    insertedLines.push(rows[0]);
  }

  return { ...entry, lines: insertedLines };
}

async function accountBalance(client, { accountId, asOf, from, to, entityId }) {
  const params = [accountId];
  let dateFilter = 'TRUE';
  if (asOf) { params.push(asOf); dateFilter = `je.entry_date <= $${params.length}`; }
  if (from) { params.push(from); dateFilter += ` AND je.entry_date >= $${params.length}`; }
  if (to) { params.push(to); dateFilter += ` AND je.entry_date <= $${params.length}`; }
  let entityFilter = 'TRUE';
  if (entityId) { params.push(entityId); entityFilter = `jl.entity_id = $${params.length}`; }
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(jl.debit),0)::numeric AS debit, COALESCE(SUM(jl.credit),0)::numeric AS credit
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = $1 AND ${dateFilter} AND ${entityFilter}`,
    params
  );
  return { debit: Number(rows[0].debit), credit: Number(rows[0].credit) };
}

module.exports = { postJournalEntry, accountBalance, EPSILON };
