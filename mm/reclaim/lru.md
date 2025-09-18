# 内存回收，继续深入 lru

## 核心流程 shrink_node()

分析最核心的 `shrink_node()`

```cpp
void shrink_node(pg_data_t *pgdat, struct scan_control *sc)
  /* 初始化 scan_control 中的一些成员，这些成员的作用是平衡active/inactive和文件页/匿名页  */
  prepare_scan_control(pgdat, sc);
  /* 核心部分 */
  shrink_node_memcgs(pgdat, sc);
    /* 忽略掉 memory cgroup，最核心的就是这两个函数，回收 lru 链表上的页面、回收 slab */
    shrink_lruvec()
    shrink_slab()
  flush_reclaim_state(sc);
  /* TODO 后面的这些暂时忽略 */
  ...
```

### anon/file 和 inactive/active 平衡

不同的内存回收触发路径会使得 scan_control 中的成员不一样，

prepare_scan_control() 也会调整 scan_control，如果满足以下条件之一，就设置 sc->may_deactivate，影响到 shrink_list() 时是否进行 shrink_active_list() 对 active anon/file 进行 deactivate。

- inactive anon/file 数量偏少。见 `inactive_is_low()`
- 从上次回收结束后到现在，这段时间内，发生了 anon/file refault 时的 active。详见 170b04b7ae49

```cpp
struct scan_control {
        unsigned int may_deactivate:2;
        /* 如果此次未完成回收目标，并且此次回收时，跳过了 shrink 某个 active list，
           就会 force_deactivate = 1，然后 retry 重试一次，这一次要强制 shrink 所有的 active list */
	unsigned int force_deactivate:1;

	unsigned int may_swap:1;

	unsigned int cache_trim_mode:1;

	unsigned int file_is_tiny:1;


	/* 越小，这次循环扫描的越多 */
	s8 priority;
}
```

scan_control 和 vm.swappiness 最终会影响 shrink_lruvec()->get_scan_count() 里计算要在 4 个 lru 链表上分别扫描的数量。
get_scan_count() 先选择 enum scan_balance，再计算出具体的数量。

- 均衡
- 只扫描 file
- 只扫描 aono
- 由 sc->anon_cost, sc->file_cost, swappiness 决定

注意：

- 在 mglru 中不会用到 get_scan_count()，而且对于 swappiness，只关心其是否为 0
- swappiness 的上限在某次 commit 变成了 200
  - c843966c556d 2020-06-03 mm: allow swappiness that prefers reclaiming anon over the file workingset
    https://lore.kernel.org/linux-mm/20200520232525.798933-4-hannes@cmpxchg.org/

---

深入 prepare_scan_control() 细节，

inactive_is_low()

### `shrink_lruvec()`

暂时忽略 MGLRU 和 memory cgroup

```cpp
/* 扫描并回收 lru 4 个链表上的页面 */
shrink_lruvec()
  /* 4 种 lru 类型的页面，我们接下来分别要扫描的数量。
     扫描数量与 sc->priority 有关。
     TODO 将来再详细分析 */
  unsigned long nr[NR_LRU_LISTS];
  unsigned long targets[NR_LRU_LISTS];
  get_scan_count(lruvec, sc, nr);
  memcpy(targets, nr, sizeof(nr));

  /* 除了 LRU_ACTIVE_ANON 以外，其余 lru list 都需要扫描完 nr[LRU_xxx] 个 */
  while (nr[LRU_INACTIVE_ANON] || nr[LRU_ACTIVE_FILE] || nr[LRU_INACTIVE_FILE])
    for_each_evictable_lru(lru)
      nr_to_scan = min(nr[lru], SWAP_CLUSTER_MAX); /* 每次循环最多扫描 32 个 */
      nr[lru] -= nr_to_scan;
      /* 扫描并回收。并返回成功回收的数量 */
      nr_reclaimed += shrink_list(lru, nr_to_scan, lruvec, sc);
      /* TODO 这里还会调整 nr[]，暂时略过。
         哪些情况不会调整 nr[]：
           如果成功回收的页面数量少于目标数量（在内存规整时，目标数量就是 1<<order）
           或者是在 direct reclaim 场景 */
      ...

  /* 扫描结束，记录回收的页面数量 */
  sc->nr_reclaimed += nr_reclaimed;
  /* 如果可以老化匿名页，并且 inactive anon 很少，则将一部分 active 老化为 inactive */
  if (...) shrink_active_list(LRU_ACTIVE_ANON)


/* 回收某个 lru list 上的页面。
   - active 会先老化为 inactive。而 inactive 会直接回收。
   - for_each_evictable_lru() 是先 shrink_list(inactive)，让 inactive 变少，
     再 shrink_list(active) 补充 inactive。为什么这么设计？ */
shrink_list()
  /* 对于 active，
     - 如果允许回收 active file/anon，则将该 active file/anon 老化为 inactive。
     - 否则就跳过，并 sc->skipped_deactivate = 1 记录下此次跳过。
       后续：如果发现此次未完成回收目标，并发现此次跳过了回收 active，就会强制回收 active */
  if is_active_lru(lru)
    if (sc->may_deactivate & (1 << is_file_lru(lru)))
      shrink_active_list()
    else sc->skipped_deactivate = 1;

  /* 对于 inactive，进行回收 */
  shrink_inactive_list(nr_to_scan, lruvec, sc, lru)
```

**shrink_inactive_list(): 回收 inactive anon/file lru**

```cpp
shrink_inactive_list()
  /* 扫描 nr_to_scan 个页面，并从 inactive lru 移除，移动到 folio_list 上。
     返回的 nr_takenn 是 folio_list 上的 page 数量 */
  LIST_HEAD(folio_list);
  lru_add_drain();  /* XXX: 为什么不是 lru_add_drain_all() */
  spin_lock_irq(&lruvec->lru_lock);
  /* 扫描 inac */
  nr_taken = isolate_lru_folios(nr_to_scan, lruvec, &folio_list, &nr_scanned, sc, lru);
  spin_unlock_irq(&lruvec->lru_lock);

  /* 回收 folio */
  shrink_folio_list(&folio_list, pgdat, sc, &stat, false, lruvec_memcg(lruvec));

  /* 将未完成回收的 folio 放回 lru */
  spin_lock_irq(&lruvec->lru_lock);
  move_folios_to_lru(lruvec, &folio_list);
  lru_note_cost_unlock_irq()


/* 回收 inactive folio */
shrink_folio_list()
  while (!list_empty(folio_list))
    /* 从链表头摘下一个 folio。
    - 进行 lock。因为之前我们是持锁 isolate_lru_folios() 的，因此不可能存在并发回收同一个 folio，
      那可能就是有其他路径在操作这个 folio 了，这种情况下跳过该 folio。
    - 如果是 unevictable 或者是 mlock 锁住不允许回收的，跳过，并可能移动到 active。
    - 如果不允许回收已经被映射到用户空间的页面，跳过。在快速回收场景，这取决于 /proc/sys/vm/zone_reclaim_mode */
    list_del(&folio->lru);
    if (!folio_trylock(folio)) goto keep;
    if (unlikely(!folio_evictable(folio))) goto keep_locked;
    if (!sc->may_unmap && folio_mapped(folio)) goto keep_locked;
```

---

**shrink_active_list(): 将 active anon/file 老化为 inactive anon/file**

```cpp

```

## folio 的 activation 和 deactivation

1. 位于 buddy system 中的空闲页面、内核自身使用（不映射给用户进程）的页面，不在任何 lru 链表里。
2. 从 buddy 分配内存后，`__ClearPageBuddy()` 清除 PG_buddy flag。如果是为了用户而分配的页面，就会 folio_add_lru() 放入 per-cpu 的 cpu_fbatches.lru_add 里
3. 当 folio_batch 满了，或者 `lru_add_drain_cpu()` 时，会把页面放进 memcg 粒度的 lruvec 链表里。因为没有 PG_active，所以放进的是 LRU_ACTIVE_ANON 或 LRU_ACTIVE_FILE 链表。
4. 对于文件页
   1. 在 filemap_read() 过程中，都会对 pagecache 文件页进行 folio_mark_accessed()，第一次会设置 PG_referenced，第二次会清除 PG_referenced 但是设置上 PG_active，第三次会设置上 PG_referenced
   2. 在 filemap_fault() 和 write_begin_get_folio() 时，因为在调用 `__filemap_get_folio()` 时没有设置 FGP_ACCESSED fgp_flags，所以不会 folio_mark_accessed()
5. 对于匿名页，会在 shrink_folio_list() 扫描 inactive lru list 时，检查所有映射了该 folio 的 pte 的 Access bit，如果存在，则 folio_set_active() 置上 PG_active。
6. 在 shrink_active_list() 时，会把一些 active lru list 里的 folio 移动到 inactive folio list
7. 疑问一：为什么匿名页不和文件页那样，在 pagefault 时就进行 active？
   疑问二：为什么在 write 文件页 pagecache 时，不 folio_mark_accessed()，但是 read 时就会 folio_mark_accessed()？

https://aistudio.google.com/app/prompts/1c_JBS1h970ftyTrpnlCUcsmaSGwkQh_P

https://aistudio.google.com/app/prompts/1zHousmm7Bwx0tn1Yarhycsq-3qgaBmRQ

总结：

- 文件页的 activation
  - folio_mark_accessed()
    - filemap_read() 时
    - `zap_p4d_range()->...->zap_present_folio_ptes()` 在 zap file folio 的 pte 时，如果发现 pte 上有 Access bit，就 folio_mark_accessed()
      - 常见于 sys_execve/sys_exit 进行 `__mmput()` 时、sys_munmap 时
    - gup 时，如果指定了 FOLL_TOUCH，就会 `follow_page_pte()->folio_mark_accessed()`
    - 其他不常见的场景。`sudo bpftrace -e 'fentry:vmlinux:folio_mark_accessed { @[kstack] = count(); }'`
  - workingset_refault()->folio_set_active() 当 refault_distance <= workingset_size 时。
  - shrink_folio_list()->folio_set_active() 当

## 对 kswapd 回写脏页的优化

2017-02-02 [\[PATCH 0/7\] mm: vmscan: fix kswapd writeback regression v2 - Johannes Weiner](https://lore.kernel.org/linux-mm/20170202191957.22872-1-hannes@cmpxchg.org/)
https://aistudio.google.com/app/prompts/1u5cddXAGbhjM1e8FWQSzpb8P-Nd3br_1

## folio 在链表之间的流转

注意：lru_to_folio() 获取的是链表尾部的 folio！

- [ ] shrink_active_list 时，

shrink_inactive_list() 时

1. lru 链表的头部是较新的 folio，尾部是较老的 folio。
2. shrink_inactive_list()->isolate_lru_folios() 从 inactive 链表取下 folio 放入 folio_list 链表，该链表里的头部是较新的 folio，尾部是较老的 folio。
3. shrink_inactive_list()->shrink_folio_list()，从尾到头遍历 folio_list 链表，也就是先遍历老的 folio，这个 folio 被取下后有 3 种结果：
   1. goto keep_locked; 最终被放回 folio_list 链表，此时该链表的头部是较新的，尾部是较老的。最终在 move_folios_to_lru() 里从老到新放进 lru 链表。
   2. goto activate_locked; 最终被放到 active lru list 内。
   3. 被回收。

## shrink_folio_list() 中，anon filio 的回收流程

1. 加入 swapcache。folio_alloc_swap(folio)
2. folio_mark_dirty(folio);
3. pageout()->writeout()->swap_writeout() 涉及到同步或异步。同步或异步完成都会 folio_end_writeback()->folio_xor_flags_has_waiters() 清除 PG_writeback
4. 如果是同步，那么返回 PAGE_SUCCESS 并且 folio_test_writeback() goto keep，放回 lru
5. 如果是异步，等到回写完成后，在将来再次 shrink_folio_list() 时，才会和同步时一样最终走到 `__remove_mapping()->__delete_from_swap_cache()` 从 swapcache 移除

##

Linux 内核中，既然被 gup 操作 pin 过的 folio 是不可以被回收的，为什么不将其标记为 PG_unevictable？
这样一来，不是可以防止该 folio 在 shrink_folio_list() 里做各种包括 folio_check_references() 在内的开销很大的检查吗？

我看在页面迁移时，move_to_new_folio() 里检查了必须要保证 folio 是 locked 的，然后后面才会 folio_expected_ref_count() 检查。
难道这就是原因？应该不是，因为 shrink_folio_list() 里也会 folio_trylock()

要 后，其 refcount/mapcount 才会稳定？才能进行检查？
因为检查要同时看 refcount 和 mapcount，存在原子性问题？假阳性？
不过，
https://lore.kernel.org/all/20230428124140.30166-1-jack@suse.cz/

## 其他

##
