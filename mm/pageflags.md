# pageflags 页标志

- [内存管理-38-页标志-1-pageflags - Hello-World3 - 博客园](https://www.cnblogs.com/hellokitty2/p/18528107)
- [Linux page flags - 知乎](https://zhuanlan.zhihu.com/p/713935921)
- [Linux - 物理内存 - 知乎](https://zhuanlan.zhihu.com/p/664104444)
- [Memory Management | What is the Utopian World!](https://utopianfuture.github.io/kernel/Memory-Management.html)

```cpp
/* 是否是 hugetlb */
PageHuge()
/* 是否是复合页，即，是否是 hugetlb 或 thp，与 PageCompound() 等同。 */
PageTransCompound()
```
