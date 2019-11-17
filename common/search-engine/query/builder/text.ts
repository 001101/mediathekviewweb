import { Field } from '../../../models';
import { Operator, TextQuery } from '../definition';
import { QueryBuilder } from './builder';

export class TextQueryBuilder extends QueryBuilder {
  private _fields: Field[];
  private _text?: string;
  private _operator: Operator;

  constructor() {
    super();

    this._fields = [];
    this._operator = Operator.And;
  }

  fields(...fields: Field[]): TextQueryBuilder {
    this._fields = fields;
    return this;
  }

  text(text: string): TextQueryBuilder {
    this._text = text;
    return this;
  }

  operator(operator: Operator): TextQueryBuilder {
    if (operator != 'or' && operator != 'and') {
      throw new Error('operator is neither and nor or');
    }

    this._operator = operator;

    return this;
  }

  build(): TextQuery {
    if (this._fields.length == 0) {
      throw new Error('no fields specified');
    }
    if (this._text == undefined) {
      throw new Error('no text specified');
    }

    const queryObj: TextQuery = {
      text: {
        fields: this._fields,
        text: this._text,
        operator: this._operator
      }
    };

    return queryObj;
  }
}
