/**
 * shared/components - 通用 UI 组件(自研,零 antd 依赖)
 *
 * 设计原则:
 * - 所有组件接收 theme: ThemeConfig prop(不依赖 useTheme,保持纯展示)
 * - 容器组件负责注入 theme,展示组件只消费
 * - 与 image-editor 插件的自研 UI 风格保持一致
 */

export { Modal } from './modal.js';
export type { ModalProps } from './modal.js';

export { ConfirmDialog } from './confirm-dialog.js';
export type { ConfirmDialogProps } from './confirm-dialog.js';

export { ContextMenu } from './context-menu.js';
export type { ContextMenuProps, ContextMenuItem } from './context-menu.js';

export { Dropdown } from './dropdown.js';
export type { DropdownProps, DropdownItem } from './dropdown.js';

export { Tooltip } from './tooltip.js';
export type { TooltipProps } from './tooltip.js';

export { ErrorBoundary } from './error-boundary.js';
export type { ErrorBoundaryProps } from './error-boundary.js';

export { AppLayout } from './app-layout.js';
export type { AppLayoutProps } from './app-layout.js';

export { MobileDrawerWrapper, MobileDrawerOverlay, MobileDrawerPanel } from './mobile-drawer-wrapper.js';
export type { MobileDrawerWrapperProps, MobileDrawerOverlayProps, MobileDrawerPanelProps } from './mobile-drawer-wrapper.js';

export { MobileNavDrawer } from './mobile-nav-drawer.js';
export type { MobileNavDrawerProps, NavRouteItem, NavProjectAction } from './mobile-nav-drawer.js';

export { MobileNavButton, MobileNavFloatingWrapper } from './mobile-nav-button.js';
export type { MobileNavButtonProps } from './mobile-nav-button.js';

export { AppearanceDialog } from './appearance-dialog.js';
export type { AppearanceDialogProps, GridStyle } from './appearance-dialog.js';

export { LanguageDialog } from './language-dialog.js';
export type { LanguageDialogProps } from './language-dialog.js';

export { LanguageSwitcher } from './language-switcher.js';
export type { LanguageSwitcherProps } from './language-switcher.js';

export { ShortcutsDialog } from './shortcuts-dialog.js';
export type { ShortcutsDialogProps } from './shortcuts-dialog.js';

export { AntdThemeProvider } from './antd-theme-provider.js';

export { ProjectCard } from './project-card.js';
export type { ProjectCardProps, ProjectCardVariant, ProjectCardAction } from './project-card.js';
export { CoverUploadModal } from './cover-upload-modal.js';
export type { CoverUploadModalProps } from './cover-upload-modal.js';

export { HomeHero } from './home-hero.js';
export type { HomeHeroProps } from './home-hero.js';

export { ProfileDropdown } from './profile-dropdown.js';
export type { ProfileDropdownProps, ProfileDropdownUser } from './profile-dropdown.js';

export { ChangelogPanel } from './changelog-panel.js';
export type { ChangelogPanelProps } from './changelog-panel.js';

export { SimpleSelect } from './simple-select.js';
export type { SimpleSelectProps, SimpleSelectOption } from './simple-select.js';

export { NodeCreateMenu } from './node-create-menu.js';
export type { NodeCreateMenuProps, AddNodeType } from './node-create-menu.js';

export { AssetDetailViewer } from './asset-detail-viewer.js';
export type { AssetDetailViewerProps } from './asset-detail-viewer.js';
export { ImageViewerStage, ZoomToolbar, useImagePanZoom } from './image-viewer.js';
export type { ImageViewerStageProps, ZoomToolbarProps, ImagePanZoom } from './image-viewer.js';

export { AssetBrowser, AssetCategorySidebar, AssetGrid, AssetList, AssetContent, AssetContextPanel } from './asset-browser/index.js';

export { LoadingOverlay } from './loading-overlay.js';
export type { LoadingOverlayProps } from './loading-overlay.js';
export type { AssetBrowserProps, AssetItem, AssetCategory, AssetCategoryGroup, ViewMode, BrowserMode } from './asset-browser/types.js';

export { PromptViewer } from './prompt-viewer.js';
export type { PromptViewerProps, PublicPromptViewItem } from './prompt-viewer.js';

export { PromptCard } from './prompt-card.js';
export type { PromptCardProps } from './prompt-card.js';
