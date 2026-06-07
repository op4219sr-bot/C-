// ============================================================================
// 底部版权声明组件
// 增强用户正版渠道意识，防止第三方篡改分发
// ============================================================================

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="py-6 px-4 border-t border-[var(--border-color)] bg-[var(--bg-card)]">
      <div className="max-w-5xl mx-auto flex flex-col items-center gap-3">
        {/* 版权信息 */}
        <p className="text-[11px] text-[var(--text-muted)]">
          © {currentYear} LightC · All rights reserved.
        </p>
      </div>
    </footer>
  );
}

export default Footer;
