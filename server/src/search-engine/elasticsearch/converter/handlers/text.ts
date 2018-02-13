import { TextQuery } from '../../../../common/search-engine';
import { ConvertHandler } from '../convert-handler';

type ElasticsearchMatchQuery = {
  match: ObjectMap<string>
}

type ElasticsearchMultiMatchType = 'best_fields' | 'most_fields' | 'cross_fields' | 'phrase' | 'phrase_prefix'
type ElasticsearchMultiMatchOperator = 'and' | 'or'

type ElasticsearchMultiMatchQuery = {
  multi_match: {
    type: ElasticsearchMultiMatchType,
    fields: string[],
    query: string,
    operator: ElasticsearchMultiMatchOperator
  }
}

export class TextQueryConvertHandler implements ConvertHandler {
  tryConvert(query: TextQuery, _index: string, _type: string): object | null {
    const canHandle = ('text' in query);

    if (!canHandle) {
      return null;
    }

    let queryObject: object;

    if (query.text.fields.length == 1) {
      queryObject = this.convertToMatch(query.text.fields[0], query.text.text);
    } else if (query.text.fields.length > 1) {
      queryObject = this.convertToMultiMatch(query);
    } else {
      throw new Error('no fields specified');
    }

    return queryObject;
  }


  convertToMatch(field: string, text: string): ElasticsearchMatchQuery {
    const queryObj: ElasticsearchMatchQuery = {
      match: {}
    };

    queryObj.match[field] = text;

    return queryObj;
  }

  convertToMultiMatch(query: TextQuery): ElasticsearchMultiMatchQuery {
    const queryObj: ElasticsearchMultiMatchQuery = {
      multi_match: {
        type: 'cross_fields',
        fields: query.text.fields,
        query: query.text.text,
        operator: query.text.operator
      }
    };

    return queryObj;
  }
}