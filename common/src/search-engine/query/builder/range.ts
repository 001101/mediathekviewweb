import { QueryBuilder, TimeQueryValueBuilder } from './';
import { RangeQuery } from '../';

export class RangeQueryBuilder extends QueryBuilder {
  private _field: string | null = null;
  private _lt: number | string | null = null;
  private _lte: number | string | null = null;
  private _gt: number | string | null = null;
  private _gte: number | string | null = null;

  build(): RangeQuery {
    if (this._field == null) {
      throw new Error('field not set');
    }

    const queryObj: RangeQuery = {
      range: {
        field: this._field
      }
    };

    if (this._lt != null) {
      queryObj.range['lt'] = this._lt;
    }
    if (this._lte != null) {
      queryObj.range['lte'] = this._lte;
    }
    if (this._gt != null) {
      queryObj.range['gt'] = this._gt;
    }
    if (this._gte != null) {
      queryObj.range['gte'] = this._gte;
    }

    return queryObj;
  }

  field(field: string): RangeQueryBuilder {
    this._field = field;

    return this;
  }

  lt(value: number | TimeQueryValueBuilder): RangeQueryBuilder {
    this._lt = (value instanceof TimeQueryValueBuilder) ? value.build() : value;

    return this;
  }

  lte(value: number | TimeQueryValueBuilder): RangeQueryBuilder {
    this._lte = (value instanceof TimeQueryValueBuilder) ? value.build() : value;

    return this;
  }

  gt(value: number | TimeQueryValueBuilder): RangeQueryBuilder {
    this._gt = (value instanceof TimeQueryValueBuilder) ? value.build() : value;

    return this;
  }

  gte(value: number | TimeQueryValueBuilder): RangeQueryBuilder {
    this._gte = (value instanceof TimeQueryValueBuilder) ? value.build() : value;

    return this;
  }
}
