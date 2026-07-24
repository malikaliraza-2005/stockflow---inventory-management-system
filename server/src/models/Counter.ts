/**
 * `counters` — DBD §2.8, atomic SKU sequence source (BR-04). The ONLY
 * collection keyed by a natural string `_id` (a category prefix), not an
 * ObjectId. Advanced via atomic `findOneAndUpdate` + `$inc` with upsert;
 * first-creation upsert races retry on the duplicate `_id` (ProductService).
 *
 * PDV-02 formatting (owned by ProductService): `<PREFIX>-<seq zero-padded to
 * 5>` (e.g. `ELEC-00042`); past 99999 the number simply widens — no reset, no
 * reuse. No indexes beyond `_id`.
 */
import { model, Schema } from 'mongoose';

export interface CounterDoc {
  _id: string; // the SKU prefix, e.g. "ELEC"
  seq: number;
}

const counterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter = model<CounterDoc>('Counter', counterSchema);
