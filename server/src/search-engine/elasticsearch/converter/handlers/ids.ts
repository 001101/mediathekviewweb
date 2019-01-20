import { IDsQuery } from '../../../../common/search-engine/query';
import { ConvertHandler, ConvertResult } from '../convert-handler';

type ElasticsearchIDsQuery = {
  ids: {
    type?: string | string[],
    values: string[]
  }
};

export class IDsQueryConvertHandler implements ConvertHandler {
  tryConvert(query: IDsQuery, _index: string, type: string): ConvertResult {
    const canHandle = ('ids' in query);

    if (!canHandle) {
      return { success: false };
    }

    const queryObject: ElasticsearchIDsQuery = {
      ids: {
        type,
        values: query.ids
      }
    };

    return { success: true, result: queryObject };
  }
}
