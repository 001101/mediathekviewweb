import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { isResponse, Response } from '../common/api/rest';
import { AggregatedEntry } from '../common/model';
import { QueryBody, SearchQuery, SearchResult, Sort } from '../common/search-engine';
import { SearchStringParser } from '../common/search-string-parser/parser';
import { toError } from '../common/utils';

@Injectable({
  providedIn: 'root'
})
export class SearchService {
  private readonly httpClient: HttpClient;
  private readonly searchStringParser: SearchStringParser;

  constructor(httpClient: HttpClient, searchStringParser: SearchStringParser) {
    this.httpClient = httpClient;
    this.searchStringParser = searchStringParser;
  }

  searchByString(searchString: string, skip: number, limit: number, ...sort: Sort[]): Observable<SearchResult<AggregatedEntry>> {
    const body: QueryBody = this.searchStringParser.parse(searchString);

    const query: SearchQuery = {
      body,
      sort,
      skip,
      limit
    };

    return this.search(query);
  }

  search(query: SearchQuery): Observable<SearchResult<AggregatedEntry>> {
    const url = '/api/v2/search';
    // const url = 'http://localhost:8080/api/v2/search';
    // const url = 'https://testing.mediathekviewweb.de/api/v2/search';

    return this.httpClient.post<Response<SearchResult<AggregatedEntry>>>(url, query, { responseType: 'json' })
      .pipe(
        map(toResult)
      );
  }
}

function toResult<T>(response: Response<T>): T {
  if (!isResponse(response)) {
    throw toError(response);
  }

  if (response.errors != null) {
    const errorMessage = JSON.stringify(response.errors, null, 2);
    throw new Error(errorMessage);
  }

  return response.result;
}
