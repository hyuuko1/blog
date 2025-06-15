#include <fcntl.h>
#include <memory.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

int test_anon_hugetlb(int flag) {
  char *m;

  /* 发生 fork 后，MAP_PRIVATE 发生 CoW，而 MAP_SHARED 的不会 */
  m = mmap(NULL, MAP_HUGE_2MB, PROT_READ | PROT_WRITE,
           flag | MAP_ANONYMOUS | MAP_HUGETLB, -1, 0);
  if (m == MAP_FAILED) {
    perror("mmap");
    exit(-1);
  }

  *m = '0';
  if (fork()) { /* parent */
    wait(NULL);
    printf("first byte is %c\n", *m);
  } else { /* child */
    *m = '1';
    exit(0);
    munmap(m, MAP_HUGE_2MB);
  }

  munmap(m, MAP_HUGE_2MB);
  return 0;
}

/*
  需要先挂载 hugetlbfs

  mkdir /dev/hugepages
  mount -t hugetlbfs hugetlbfs /dev/hugepages \
        -o rw,nosuid,nodev,relatime,pagesize=2M

  mkdir /dev/hugepages-1GB
  mount -t hugetlbfs hugetlbfs /dev/hugepages-1GB \
        -o rw,nosuid,nodev,relatime,pagesize=1024M
*/
int test_file_hugetlb(int flag) {
  char *m;
  int fd;
  const char *huge_gb_path = "/dev/hugepages-1GB/test";

  fd = open(huge_gb_path, O_CREAT | O_RDWR, S_IRWXU);
  if (fd < 0) {
    perror("open /dev/hugepages-1GB");
    exit(-1);
  }

  m = mmap(NULL, MAP_HUGE_1GB, PROT_READ | PROT_WRITE, flag, fd, 0);
  if (m == MAP_FAILED) {
    perror("mmap /dev/hugepages-1GB");
    exit(-1);
  }

  *m = '0';
  if (fork()) { /* parent */
    wait(NULL);
    printf("first byte is %c\n", *m);
  } else { /* child */
    *m = '1';
    munmap(m, MAP_HUGE_1GB);
    exit(0);
  }

  munmap(m, MAP_HUGE_1GB);

  return 0;
}

/* 验证 mmap 申请大页内存。

   先预留大页内存：
   echo 10 > /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages
   或 sysctl -w vm.nr_hugepages=10

   ./a.out 0|1
   0 代表 MAP_PRIVATE，
   1 代表 MAP_SHARED
*/
int main(int argc, char *argv[]) {
  int flag;
  if (argc != 2) {
    printf("usage: %s 0|1\n", argv[0]);
    return -1;
  }
  if (argv[1][0] == '0') {
    flag = MAP_PRIVATE;
  } else {
    flag = MAP_SHARED;
  }

  test_anon_hugetlb(flag);
  test_file_hugetlb(flag);
}
