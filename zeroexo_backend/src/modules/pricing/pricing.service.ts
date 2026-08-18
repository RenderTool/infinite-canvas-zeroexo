/**
 * 定价服务 — 目录只读
 */
import { Injectable } from '@nestjs/common';
import {
  listPricingCatalog,
  type PricingCatalogEntry,
} from './catalog';

@Injectable()
export class PricingService {
  /** 列出全部定价条目(只读) */
  listCatalog(): PricingCatalogEntry[] {
    return listPricingCatalog();
  }
}
