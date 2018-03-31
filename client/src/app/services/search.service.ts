import 'rxjs/add/operator/toPromise';

import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { AggregatedEntry, Field } from '../common/model';
import { QueryBody, SearchQuery, SearchResult } from '../common/search-engine';
import { SearchStringParser } from '../common/search-string-parser/parser';

@Injectable()
export class SearchService {
  private readonly httpClient: HttpClient;
  private readonly searchStringParser: SearchStringParser;

  constructor(httpClient: HttpClient, searchStringParser: SearchStringParser) {
    this.httpClient = httpClient;
    this.searchStringParser = searchStringParser;
  }

  async search(searchString: string): Promise<SearchResult<AggregatedEntry>> {
    const queryBody: QueryBody = this.searchStringParser.parse(searchString);

    const query: SearchQuery = {
      body: queryBody,
      sort: [{
        field: Field.Timestamp,
        order: 'descending'
      },
      {
        field: Field.Channel,
        order: 'ascending'
      }],
      skip: 0,
      limit: 50
    };

    //const url = '/api/v2/search';
    // const url = 'http://localhost:8080/api/v2/search';
    const url = 'https://testing.mediathekviewweb.de/api/v2/search';
    const response = await this.httpClient.post(url, query, { responseType: 'json' }).toPromise();

    const formattedQuery = JSON.stringify(query, null, 2);
    const formattedResponse = JSON.stringify(response, null, 2);

    return (response as any).result as SearchResult<AggregatedEntry>;
  }
}
