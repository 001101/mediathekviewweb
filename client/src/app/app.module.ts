import { registerLocaleData } from '@angular/common';
import german from '@angular/common/locales/de';
import { LOCALE_ID, NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ServiceWorkerModule } from '@angular/service-worker';
import { environment } from '../environments/environment';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { EntryListComponent } from './components/entry-list/entry-list.component';
import { NavbarComponent } from './components/navbar/navbar.component';
import { SearchInputComponent } from './components/search-input/search-input.component';
import { SearchComponent } from './components/search/search.component';
import { AngularMaterialModule } from './modules/angular-material.module';
import { DevComponent } from './sites/dev/dev.component';
import { HomeComponent } from './sites/home/home.component';

registerLocaleData(german, 'de');

@NgModule({
  declarations: [
    AppComponent,
    DevComponent,
    HomeComponent,
    NavbarComponent,
    SearchInputComponent,
    EntryListComponent,
    SearchComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    ServiceWorkerModule.register('ngsw-worker.js', { enabled: environment.production }),
    BrowserAnimationsModule,
    ReactiveFormsModule,
    AngularMaterialModule
  ],
  providers: [{ provide: LOCALE_ID, useValue: 'de_DE' }],
  bootstrap: [AppComponent]
})
export class AppModule { }
