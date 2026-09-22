<template>
  <slot />
</template>

<script setup lang="ts">
import { useMessage, useDialog, useNotification } from 'naive-ui'

if (import.meta.client) {
  // 在 NaiveProvider 子树中调用 hooks；通过 window 全局暴露供 useToast / 各处 $dialog 调用
  const message = useMessage()
  const dialog = useDialog()
  const notification = useNotification()
  ;(window as any).$message = message
  ;(window as any).$dialog = dialog
  ;(window as any).$notification = notification
}
</script>
