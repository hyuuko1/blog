# GUP (Get User Page)

- [宋宝华：论 Linux 的页迁移（Page Migration）完整版](https://cloud.tencent.com/developer/article/1681326)

## gup 是如何防止 page 被迁移

gup 会对 folio 的 refcount 增加 GUP_PIN_COUNTING_BIAS

以内存规整流程里的页面迁移为例，

```cpp
compact_zone()
  migrate_pages()->migrate_pages_batch()->migrate_folios_move()->migrate_folio_move()
    move_to_new_folio()->migrate_folio()->__migrate_folio()
      /* detect unexpected references (e.g., GUP or other temporary references) */
      expected_count = folio_expected_ref_count(src) + 1;
      if (folio_ref_count(src) != expected_count)
        return -EAGAIN;
      folio_mc_copy(dst, src);
      __folio_migrate_mapping()
```
