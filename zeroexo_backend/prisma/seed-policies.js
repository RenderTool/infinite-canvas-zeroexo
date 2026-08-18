/**
 * seed-policies.js - 初始化政策文档数据（版本化）
 *
 * 用法: node prisma/seed-policies.js
 * 需要在 zeroexo_backend 目录下执行，且 .env 中 DATABASE_URL 有效
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const POLICIES = [
  {
    key: 'privacy',
    title: '隐私政策',
    titleEn: 'Privacy Policy',
    titleJa: 'プライバシーポリシー',
    type: 'policy',
    content: `## 一、引言

ZeroExo（以下简称"我们"）非常重视用户（以下简称"您"）的隐私和个人信息保护。您在使用我们的产品与/或服务时，我们可能会收集和使用您的相关个人信息。本隐私政策旨在向您说明我们如何收集、使用、存储和保护您的个人信息，以及您享有的相关权利。请您在使用我们的服务前仔细阅读本政策，一旦您开始使用我们的服务，即表示您已充分理解并同意本政策的内容。

## 二、我们收集的信息

在您使用我们的服务时，我们可能会收集以下类型的信息：

### 1. 账户信息

当您注册账户时，我们会收集您的邮箱地址和用户名。这些信息用于创建和维护您的账户，以及为您提供个性化的服务体验。

### 2. 使用数据

我们会自动收集您在使用服务过程中产生的浏览记录、操作日志等信息。这些数据帮助我们了解用户的使用习惯，以便持续改进我们的产品和服务。

### 3. 设备信息

我们会收集您的浏览器类型、IP地址、操作系统版本等设备相关信息。这些信息用于保障服务的安全运行，以及优化不同设备上的显示效果。

## 三、信息使用方式

我们收集的信息将用于以下目的：提供、维护和改进我们的服务；改善用户体验，包括个性化内容推荐和界面优化；向您发送服务相关的通知和更新信息；检测和防止潜在的安全威胁或滥用行为。我们不会将您的个人信息用于与本政策未明确说明的其他用途。

## 四、信息共享与披露

我们郑重承诺：不会向任何第三方出售您的个人信息。在以下情况下，我们可能会披露您的信息：（1）获得您的明确同意；（2）法律法规或政府部门要求；（3）为保护我们的合法权益或公共安全。我们可能会与为我们提供服务的可信第三方（如云服务提供商）共享必要的信息，但会要求其遵守严格的保密和安全义务。

## 五、数据安全

我们采取合理的技术和管理措施来保护您的个人信息安全，包括但不限于数据加密传输、访问控制、安全审计等。然而，没有任何系统能够保证绝对的安全，我们会持续改进安全措施，并在发现安全漏洞时及时通知受影响的用户。

## 六、用户权利

您有权访问、更正或删除我们持有的您的个人数据。您可以通过账户设置页面自行管理您的个人信息，也可以联系我们来行使这些权利。我们将在合理的时间内响应您的请求。请注意，某些情况下我们可能需要保留部分信息以遵守法律义务。

## 七、政策更新

我们可能会不时更新本隐私政策。当政策发生重大变更时，我们会通过站内通知或邮件等方式告知您。重大变更包括但不限于：我们收集个人信息的目的、方式、范围发生重大变化；我们的核心业务发生重大调整；我们因合并、收购等原因导致信息控制者变更。建议您定期查阅本页面以了解最新的隐私政策信息。

## 八、联系我们

如果您对本隐私政策有任何疑问或建议，或需要行使您的个人信息相关权利，请通过以下方式联系我们：

邮箱：support@zeroexo.app

GitHub Issues：https://github.com/zeroexo/zeroexo/issues

我们将在收到您的请求后尽快回复，通常不超过15个工作日。`,
    contentEn: `## 1. Introduction

ZeroExo ("we", "us", or "our") attaches great importance to the protection of your privacy and personal information. When you use our products and/or services, we may collect and use your personal information. This Privacy Policy explains how we collect, use, store, and protect your personal information, as well as your relevant rights. Please read this policy carefully before using our services. By using our services, you acknowledge that you have read and understood this policy.

## 2. Information We Collect

When you use our services, we may collect the following types of information:

### 2.1 Account Information

When you register an account, we collect your email address and username. This information is used to create and maintain your account and provide you with a personalized service experience.

### 2.2 Usage Data

We automatically collect browsing records, operation logs, and other information generated during your use of the service. This data helps us understand user habits so we can continuously improve our products and services.

### 2.3 Device Information

We collect device-related information such as your browser type, IP address, and operating system version. This information is used to ensure the secure operation of the service and optimize display effects on different devices.

## 3. How We Use Information

The information we collect is used for the following purposes: providing, maintaining, and improving our services; enhancing user experience, including personalized content recommendations and interface optimization; sending you service-related notifications and updates; detecting and preventing potential security threats or abuse. We will not use your personal information for purposes not explicitly stated in this policy.

## 4. Information Sharing and Disclosure

We solemnly promise: we will not sell your personal information to any third party. We may disclose your information in the following circumstances: (1) with your explicit consent; (2) as required by laws, regulations, or government authorities; (3) to protect our legitimate rights or public safety. We may share necessary information with trusted third parties who provide services to us (such as cloud service providers), but we will require them to comply with strict confidentiality and security obligations.

## 5. Data Security

We implement reasonable technical and administrative measures to protect the security of your personal information, including but not limited to encrypted data transmission, access control, and security audits. However, no system can guarantee absolute security. We will continuously improve security measures and promptly notify affected users when security vulnerabilities are discovered.

## 6. Your Rights

You have the right to access, correct, or delete your personal data held by us. You can manage your personal information through your account settings page, or contact us to exercise these rights. We will respond to your request within a reasonable time. Please note that in some cases we may need to retain certain information to comply with legal obligations.

## 7. Policy Updates

We may update this Privacy Policy from time to time. When material changes are made, we will notify you through in-app notifications or email. Material changes include but are not limited to: significant changes in the purpose, method, or scope of personal information collection; major adjustments to our core business; changes in the data controller due to mergers, acquisitions, etc. We recommend that you periodically review this page for the latest privacy policy information.

## 8. Contact Us

If you have any questions or suggestions regarding this Privacy Policy, or need to exercise your rights regarding personal information, please contact us through the following channels:

Email: support@zeroexo.app

GitHub Issues: https://github.com/zeroexo/zeroexo/issues

We will respond to your request as soon as possible, typically within 15 business days.`,
    contentJa: `## 1. はじめに

ZeroExo（以下「当社」といいます）は、ユーザー（以下「お客様」といいます）のプライバシーと個人情報の保護を非常に重視しています。お客様が当社の製品および/またはサービスをご利用になる際、当社はお客様の個人情報を収集し利用することがあります。本プライバシーポリシーは、当社がお客様の個人情報をどのように収集、利用、保存、保護するか、およびお客様の権利について説明するものです。本ポリシーをよくお読みいただき、サービスをご利用いただくことで、本ポリシーの内容に同意したものとみなされます。

## 2. 収集する情報

お客様が当社のサービスをご利用になる際、当社は以下の種類の情報を収集することがあります：

### 2.1 アカウント情報

アカウント登録時に、メールアドレスとユーザー名を収集します。これらの情報は、アカウントの作成と維持、およびパーソナライズされたサービス体験の提供に使用されます。

### 2.2 利用データ

サービス利用中に生成される閲覧履歴、操作ログなどの情報を自動的に収集します。このデータは、ユーザーの利用習慣を理解し、製品とサービスを継続的に改善するために役立ちます。

### 2.3 デバイス情報

ブラウザの種類、IPアドレス、オペレーティングシステムのバージョンなどのデバイス関連情報を収集します。これらの情報は、サービスの安全な運用と、さまざまなデバイスでの表示最適化に使用されます。

## 3. 情報の利用方法

収集した情報は、以下の目的で使用されます：サービスの提供、維持、改善；パーソナライズされたコンテンツの推奨やインターフェースの最適化を含むユーザー体験の向上；サービス関連の通知や更新情報の送信；潜在的なセキュリティ脅威や不正使用の検出と防止。当社は、本ポリシーに明記されていない目的でお客様の個人情報を利用することはありません。

## 4. 情報の共有と開示

当社は、お客様の個人情報を第三者に販売しないことを厳重に誓約します。以下の状況で情報を開示することがあります：（1）お客様の明示的な同意を得た場合；（2）法律、規制、または政府機関の要求による場合；（3）当社の正当な権利または公共の安全を保護するため。当社は、サービスを提供する信頼できる第三者（クラウドサービスプロバイダーなど）と必要な情報を共有することがありますが、厳格な機密保持とセキュリティ義務の遵守を要求します。

## 5. データセキュリティ

当社は、暗号化されたデータ転送、アクセス制御、セキュリティ監査などを含む合理的な技術的および管理的措置を講じて、お客様の個人情報を保護します。ただし、絶対的なセキュリティを保証できるシステムはありません。当社はセキュリティ対策を継続的に改善し、セキュリティの脆弱性が発見された場合は、影響を受けるユーザーに速やかに通知します。

## 6. ユーザーの権利

お客様は、当社が保有するお客様の個人データにアクセスし、修正し、または削除する権利を有します。アカウント設定ページから個人情報を管理するか、当社に連絡してこれらの権利を行使することができます。当社は合理的な期間内にご要望に対応します。法律上の義務を遵守するために一部の情報を保持する必要がある場合があることにご注意ください。

## 7. ポリシーの更新

当社は本プライバシーポリシーを随時更新することがあります。重要な変更があった場合は、アプリ内通知やメールなどでお知らせします。重要な変更には、個人情報収集の目的、方法、範囲の大幅な変更；中核事業の大幅な調整；合併、買収などによる情報管理会社の変更が含まれますが、これらに限定されません。最新のプライバシーポリシー情報については、定期的にこのページをご確認ください。

## 8. お問い合わせ

本プライバシーポリシーに関するご質問やご提案、または個人情報に関する権利を行使する必要がある場合は、以下の方法でお問い合わせください：

メール：support@zeroexo.app

GitHub Issues：https://github.com/zeroexo/zeroexo/issues

ご依頼を受けてから、通常15営業日以内にできるだけ早く回答いたします。`,
  },
  {
    key: 'terms',
    title: '用户服务协议',
    titleEn: 'Terms of Service',
    titleJa: '利用規約',
    type: 'policy',
    content: `## 1. 协议的接受

欢迎使用 ZeroExo AI。请您在使用 ZeroExo AI 提供的各项服务前，仔细阅读并充分理解本《用户服务协议》（以下简称"本协议"）。您通过访问或使用本平台的服务，即表示您同意接受本协议的全部条款和条件的约束。如果您不同意本协议的任何部分，请立即停止使用本平台提供的服务。本平台保留随时修改本协议的权利，修改后的协议一经发布即生效，恕不另行通知。

## 2. 服务说明

ZeroExo AI 是一款基于人工智能技术的创作工具平台，为用户提供包括但不限于 AI 文本生成、图像生成、视频生成、音频生成等创作工具和服务（以下简称"服务"）。本平台致力于通过 AI 技术辅助用户激发创意灵感、提升创作效率。平台提供的服务可能根据技术发展和业务需求进行调整、更新或升级，具体以平台实际提供的功能为准。

## 3. 用户账户

您在使用本平台的部分功能时，可能需要注册一个账户。在注册账户时，您同意提供真实、准确、完整的注册信息，并对其及时更新负责。您有责任妥善保管账户密码及账号信息，对通过您账户进行的所有活动负全部责任。如您发现任何未经授权使用您账户的情况，应立即通知本平台。若您为未成年人，应在法定监护人的同意和指导下使用本平台的服务。

## 4. 用户行为规范

您承诺在使用本平台服务时，遵守国家法律法规及本协议的相关规定，不得利用本平台从事任何违法或不当行为。禁止行为包括但不限于：（1）上传、发布或传播任何违反法律法规、社会公德或侵犯他人合法权益的内容；（2）滥用 API 接口，包括但不限于超出合理频率调用、利用 API 进行自动化攻击或爬取等行为；（3）对本平台的软件、系统或代码进行反向工程、反编译、反汇编或试图获取源代码；（4）干扰或破坏本平台的正常运行，或对平台服务器及网络施加不合理负载。如发现您存在上述违规行为，本平台有权立即终止您的服务，并保留追究法律责任的权利。

## 5. 用户内容

您使用本平台生成的所有内容（以下简称"用户内容"）的版权归您所有。您对用户内容享有完全的自主知识产权，但您授予本平台一项非排他的、免费的、全球范围内的展示权利，即本平台可以在其官方网站、社交媒体渠道及其他宣传材料中展示您创作的内容，用于产品推广和展示目的。您理解并同意，本平台有权对用户内容进行审核，如发现用户内容存在违法或违规情形，平台有权删除相关内容。

## 6. 免责声明

本平台按"现状"和"可用"的原则提供服务，不提供任何形式的明示或暗示的保证。AI 生成的内容由人工智能模型自动生成，仅供您参考和辅助创作使用，不构成任何专业建议。本平台不对 AI 生成内容的准确性、完整性、可靠性或适用性作任何保证。您应自行对 AI 生成内容进行判断和验证，并承担使用 AI 生成内容所产生的一切风险和责任。

## 7. 责任限制

在法律允许的最大范围内，本平台不对因使用或无法使用本平台服务而产生的任何间接损失、附带损失、特殊损失、惩罚性损失或后果性损失承担责任，包括但不限于数据丢失、业务中断、利润损失或商誉损害等。无论基于何种法律理论（包括合同、侵权、严格责任等），本平台的累计赔偿责任总额不超过您在过去十二个月内向本平台支付的费用总额。

## 8. 终止

本平台有权在下列情况下立即终止或暂停您使用本平台服务的权利：（1）您违反本协议的任何条款；（2）您从事违法或欺诈活动；（3）根据法律法规或政府机关的要求。协议终止后，您使用本平台服务的权利立即终止，本平台保留删除您相关数据的权利，但法律法规另有规定的除外。本协议中按其性质应当存续的条款（包括但不限于知识产权、免责声明、责任限制等）在协议终止后继续有效。

## 9. 法律适用与争议解决

本协议的订立、执行、解释及争议解决均适用中华人民共和国法律。因本协议引起或与本协议有关的任何争议，双方应首先友好协商解决；协商不成的，任何一方均可将争议提交至本平台所在地有管辖权的人民法院诉讼解决。

## 10. 联系我们

如您对本协议或本平台的服务有任何疑问、意见或建议，请通过以下邮箱与我们联系：support@zeroexo.ai。我们将尽快回复您的咨询。`,
    contentEn: `## 1. Acceptance of Terms

Welcome to ZeroExo AI. Please read and fully understand these Terms of Service (the "Terms") before using any services provided by ZeroExo AI. By accessing or using our services, you agree to be bound by all the terms and conditions of these Terms. If you do not agree with any part of these Terms, please immediately stop using our services. We reserve the right to modify these Terms at any time. Modified Terms will take effect immediately upon publication without prior notice.

## 2. Service Description

ZeroExo AI is an AI-powered creative tool platform that provides users with creative tools and services including but not limited to AI text generation, image generation, video generation, and audio generation (collectively, the "Services"). Our platform is dedicated to helping users spark creative inspiration and improve creative efficiency through AI technology. The services provided may be adjusted, updated, or upgraded based on technological development and business needs, subject to the actual functions available on the platform.

## 3. User Accounts

You may need to register an account to use certain features of our platform. When registering, you agree to provide true, accurate, and complete registration information and to keep it updated. You are responsible for safeguarding your account password and information, and for all activities that occur under your account. If you discover any unauthorized use of your account, you must immediately notify us. If you are a minor, you should use our services under the consent and guidance of your legal guardian.

## 4. User Conduct

You agree to comply with all applicable laws and regulations when using our services. Prohibited behaviors include but are not limited to: (1) uploading, posting, or transmitting any content that violates laws, regulations, or infringes upon the rights of others; (2) abusing API interfaces, including excessive calling or using APIs for automated attacks or scraping; (3) reverse engineering, decompiling, or disassembling our software, systems, or code; (4) interfering with or disrupting the normal operation of our platform. We reserve the right to immediately terminate your access if you violate these terms.

## 5. User Content

You retain all copyright and intellectual property rights to content generated using our platform ("User Content"). You grant us a non-exclusive, royalty-free, worldwide license to display your User Content on our official website, social media channels, and other promotional materials for product promotion and demonstration purposes. We reserve the right to review User Content and remove any content that violates applicable laws or these Terms.

## 6. Disclaimer

Our services are provided on an "as is" and "as available" basis without any warranties, express or implied. AI-generated content is automatically produced by AI models and is provided for reference and creative assistance only. It does not constitute professional advice. We make no warranties regarding the accuracy, completeness, reliability, or suitability of AI-generated content. You should evaluate and verify AI-generated content and assume all risks and liabilities associated with its use.

## 7. Limitation of Liability

To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, punitive, or consequential damages arising from the use or inability to use our services. Our total cumulative liability shall not exceed the total fees paid by you to us in the twelve months preceding the claim.

## 8. Termination

We reserve the right to immediately terminate or suspend your access to our services if you violate any terms of this agreement, engage in illegal or fraudulent activities, or as required by law or government authorities. Upon termination, your right to use our services immediately ceases.

## 9. Governing Law

These Terms shall be governed by and construed in accordance with the laws of the People's Republic of China. Any disputes arising from these Terms shall first be resolved through friendly negotiation. If negotiation fails, either party may submit the dispute to the competent court in our platform's jurisdiction.

## 10. Contact Us

If you have any questions about these Terms or our services, please contact us at: support@zeroexo.ai.`,
    contentJa: `## 1. 契約の承諾

ZeroExo AIへようこそ。本サービスをご利用いただく前に、本利用規約（以下「本規約」といいます）をよくお読みいただき、十分にご理解ください。本プラットフォームのサービスにアクセスまたはご利用いただくことで、本規約のすべての条項に拘束されることに同意したものとみなされます。本規約のいずれかの部分に同意できない場合は、直ちにサービスの利用を中止してください。本プラットフォームは、随時本規約を変更する権利を有します。変更後の規約は、公開と同時に効力を生じるものとします。

## 2. サービスの説明

ZeroExo AIは、AI技術を活用したクリエイティブツールプラットフォームであり、AIテキスト生成、画像生成、動画生成、音声生成などを含む（ただしこれらに限定されない）クリエイティブツールとサービス（以下「本サービス」といいます）を提供します。本プラットフォームは、AI技術を通じてユーザーの創造性を刺激し、制作効率を向上させることを目指しています。

## 3. ユーザーアカウント

本プラットフォームの一部の機能をご利用いただくには、アカウントの登録が必要な場合があります。登録の際、正確かつ完全な情報を提供し、常に最新の状態に保つことに同意するものとします。アカウントのパスワードと情報を適切に管理し、アカウントを通じて行われるすべての活動について責任を負うものとします。

## 4. ユーザーの行動規範

ユーザーは、本サービスの利用にあたり、関連法規および本規約を遵守することに同意します。禁止行為には以下が含まれますが、これらに限定されません：（1）法令や公序良俗に違反するコンテンツのアップロード、投稿、送信；（2）APIインターフェースの濫用；（3）リバースエンジニアリング、逆コンパイル、逆アセンブル行為；（4）プラットフォームの正常な運営を妨害する行為。

## 5. ユーザーコンテンツ

本プラットフォームを使用して生成されたすべてのコンテンツ（以下「ユーザーコンテンツ」といいます）の著作権はユーザーに帰属します。ユーザーは、本プラットフォームに対し、製品の宣伝および展示を目的として、公式ウェブサイトやソーシャルメディアでユーザーコンテンツを表示するための非独占的、無償、世界的なライセンスを付与するものとします。

## 6. 免責事項

本サービスは「現状有姿」および「利用可能な状態」で提供され、明示または黙示を問わずいかなる保証も行いません。AI生成コンテンツは参考および補助的な創作のために提供されるものであり、専門的なアドバイスを構成するものではありません。

## 7. 責任の制限

法令で認められる最大限の範囲において、本プラットフォームは、本サービスの利用または利用不能から生じるいかなる間接的、付随的、特別、懲罰的、または結果的損害についても責任を負いません。

## 8. 契約の終了

本プラットフォームは、ユーザーが本規約に違反した場合、違法行為や不正行為を行った場合、または法令や政府機関の要求に基づき、直ちにサービスの提供を終了または停止する権利を有します。

## 9. 準拠法

本規約の成立、執行、解釈および紛争解決は、中華人民共和国の法律に準拠します。

## 10. お問い合わせ

本規約に関するご質問は、support@zeroexo.aiまでお問い合わせください。`,
  },
  {
    key: 'disclaimer',
    title: '法律声明',
    titleEn: 'Legal Disclaimer',
    titleJa: '法的免責事項',
    type: 'policy',
    content: `## 1. 版权声明

本平台（ZeroExo AI）的界面设计、用户界面元素、前端代码、后端系统、Logo 标识、品牌形象等所有知识产权和相关权利，均归 ZeroExo AI 及其运营方所有。未经本平台书面许可，任何单位或个人不得以任何方式复制、转载、修改、传播、出售或利用本平台的任何部分。本平台保留追究侵权者法律责任的权利。

## 2. 用户生成内容责任

用户对其通过本平台发布、上传、生成或分享的所有内容（以下简称"用户内容"）承担全部法律责任。具体包括但不限于：（1）用户保证其内容的合法性，不得包含违反中华人民共和国法律法规的内容；（2）用户保证其内容不侵犯任何第三方的合法权益，包括但不限于著作权、商标权、专利权、肖像权、隐私权等；（3）用户保证其内容不违反任何适用的法律法规、行政规章或政策规定。如因用户内容引发任何法律纠纷或索赔，由用户自行承担全部责任，与本平台无关。

## 3. AI 生成内容免责

本平台基于人工智能技术生成的内容（以下简称"AI 内容"）可能不准确、不完整或包含错误信息。AI 内容仅供用户参考和辅助创作，不构成任何形式的专业意见或建议。用户在使用 AI 内容前，应自行对内容进行审核、验证和判断，并根据自身需求对 AI 内容进行修改和完善。本平台不对 AI 内容的准确性、可靠性、适用性及合法性作任何保证，也不对因使用 AI 内容所产生的任何后果承担责任。

## 4. 第三方链接

本平台可能包含指向第三方网站或服务的链接（以下简称"第三方链接"）。这些第三方链接仅为方便用户而提供，不构成本平台对第三方网站或服务的任何推荐、认可或担保。本平台无法控制第三方网站的内容、隐私政策或服务条款，因此不对因使用第三方链接所产生的任何损失或损害承担责任。用户访问第三方链接时，应自行了解并遵守该第三方网站的相关规定。

## 5. 知识产权

用户保留其通过本平台创作的内容的所有知识产权。本协议中的任何内容均不构成对用户知识产权的转让或放弃。用户理解并同意，为提供技术服务的必要，本平台需要对用户内容进行存储、处理和分析，但不会将用户内容用于除服务提供和产品改进之外的商业用途。本平台将采取合理的技术措施保护用户内容的安全。

## 6. 适用法律

本法律声明及您对本平台的使用均适用中华人民共和国法律。如本声明的任何条款被认定为无效或不可执行，不影响其他条款的效力。本平台保留对本法律声明的最终解释权。如有任何疑问，请通过 contact@zeroexo.ai 与我们联系。`,
    contentEn: `## 1. Copyright Notice

All intellectual property rights and related rights in the interface design, user interface elements, front-end code, back-end systems, logos, and brand identity of this platform (ZeroExo AI) are owned by ZeroExo AI and its operators. Without our written permission, no individual or entity may reproduce, distribute, modify, transmit, sell, or exploit any part of this platform. We reserve the right to pursue legal action against infringers.

## 2. User-Generated Content Responsibility

Users bear full legal responsibility for all content posted, uploaded, generated, or shared through our platform. Users warrant that their content: (1) complies with applicable laws and regulations; (2) does not infringe upon the rights of any third party; (3) does not violate any applicable laws, regulations, or policies. Users shall be solely responsible for any legal disputes or claims arising from their content.

## 3. AI-Generated Content Disclaimer

AI-generated content may be inaccurate, incomplete, or contain errors. It is provided for reference and creative assistance only and does not constitute professional advice. Users should review, verify, and evaluate AI-generated content before use. We make no warranties regarding the accuracy, reliability, suitability, or legality of AI-generated content.

## 4. Third-Party Links

Our platform may contain links to third-party websites or services. These links are provided for convenience only and do not constitute endorsement or guarantee. We have no control over the content, privacy policies, or terms of service of third-party websites.

## 5. Intellectual Property

Users retain all intellectual property rights to content created through our platform. Nothing in this agreement constitutes a transfer or waiver of user intellectual property rights. We may store, process, and analyze user content as necessary to provide technical services, but will not use it for commercial purposes beyond service provision and product improvement.

## 6. Governing Law

This Legal Notice and your use of our platform are governed by the laws of the People's Republic of China. If any provision is found to be invalid or unenforceable, the remaining provisions shall remain in effect. For any questions, please contact us at contact@zeroexo.ai.`,
    contentJa: `## 1. 著作権表示

本プラットフォーム（ZeroExo AI）のインターフェースデザイン、ユーザーインターフェース要素、フロントエンドコード、バックエンドシステム、ロゴ、ブランドイメージに関するすべての知的財産権および関連する権利は、ZeroExo AIおよびその運営者に帰属します。書面による許可なく、本プラットフォームの一部を複製、転載、修正、送信、販売することはできません。

## 2. ユーザー生成コンテンツの責任

ユーザーは、本プラットフォームを通じて公開、アップロード、生成、共有するすべてのコンテンツについて、完全な法的責任を負うものとします。ユーザーは、コンテンツが関連法規に準拠し、第三者の権利を侵害せず、適用される法律や規制に違反しないことを保証するものとします。

## 3. AI生成コンテンツの免責

AI生成コンテンツは、不正確、不完全、または誤情報を含む可能性があります。参考および補助的な創作のために提供されるものであり、専門的なアドバイスを構成するものではありません。ユーザーは、AI生成コンテンツを使用する前に、自ら内容を確認、検証、判断するものとします。

## 4. サードパーティリンク

本プラットフォームには、サードパーティのウェブサイトやサービスへのリンクが含まれる場合があります。これらのリンクは利便性のために提供されるものであり、推奨や保証を構成するものではありません。

## 5. 知的財産権

ユーザーは、本プラットフォームを通じて作成したコンテンツのすべての知的財産権を保持します。本契約のいかなる条項も、ユーザーの知的財産権の譲渡または放棄を構成するものではありません。

## 6. 準拠法

本法的通知およびお客様による本プラットフォームの利用は、中華人民共和国の法律に準拠します。ご質問は、contact@zeroexo.aiまでお問い合わせください。`,
  },
  {
    key: 'about',
    title: '关于我们',
    titleEn: 'About Us',
    titleJa: '私たちについて',
    type: 'policy',
    content: `## 关于 ZeroExo AI

ZeroExo AI 是一款基于人工智能的创意工具平台，致力于为创作者提供高效、智能的创作体验。我们结合了先进的 AI 模型与直观的交互设计，让每个人都能轻松将灵感转化为精彩作品。

## 核心功能

- 智能画布 — AI 辅助创作，实时生成与编辑
- AI 提示词库 — 海量精选提示词，激发创作灵感
- 素材管理 — 一站式云端素材存储与分类管理
- 故事板创作 — 快速构建分镜脚本，可视化叙事流程

## 我们的使命

让 AI 创作更简单、更高效。我们相信，AI 不应是创作的障碍，而是激发灵感的催化剂。ZeroExo AI 将持续迭代，为全球创作者提供更强大的工具和更流畅的体验。

## 技术栈

基于 React 19 + TypeScript 构建前端，采用 Rust 高性能后端服务，集成多模态 AI 模型（文本生成、图像生成、语音合成），并支持实时协作与云端存储。

## 联系我们

GitHub：github.com/zeroexo

邮箱：contact@zeroexo.ai`,
    contentEn: `## About ZeroExo AI

ZeroExo AI is an AI-powered creative tool platform dedicated to providing creators with an efficient and intelligent creative experience. By combining advanced AI models with intuitive interaction design, we make it easy for everyone to turn inspiration into outstanding works.

## Core Features

- Smart Canvas — AI-assisted creation with real-time generation and editing
- AI Prompt Library — Curated prompts to spark creative inspiration
- Asset Management — One-stop cloud storage and organization
- Storyboard Creation — Rapid storyboard construction with visual narrative flow

## Our Mission

Make AI creation simpler and more efficient. We believe AI should not be a barrier to creation, but a catalyst for inspiration. ZeroExo AI will continue to evolve, providing creators worldwide with more powerful tools and smoother experiences.

## Tech Stack

Built with React 19 + TypeScript frontend, Rust high-performance backend services, integrated multimodal AI models (text generation, image generation, speech synthesis), with real-time collaboration and cloud storage support.

## Contact Us

GitHub: github.com/zeroexo

Email: contact@zeroexo.ai`,
    contentJa: `## ZeroExo AIについて

ZeroExo AIは、AIを活用したクリエイティブツールプラットフォームであり、クリエイターに効率的でインテリジェントな制作体験を提供することを使命としています。先進的なAIモデルと直感的なインタラクションデザインを組み合わせ、誰もがインスピレーションを素晴らしい作品に変換できるようにします。

## コア機能

- スマートキャンバス — AI支援によるリアルタイム生成と編集
- AIプロンプトライブラリ — 厳選されたプロンプトで創造性を刺激
- アセット管理 — ワンストップのクラウドストレージと整理
- ストーリーボード作成 — ビジュアルなナラティブフローで素早く構築

## 私たちの使命

AI創作をよりシンプルに、より効率的に。AIは創作の障壁ではなく、インスピレーションの触媒であると信じています。ZeroExo AIは進化を続け、世界中のクリエイターにより強力なツールとよりスムーズな体験を提供します。

## 技術スタック

React 19 + TypeScriptによるフロントエンド、Rustによる高性能バックエンド、マルチモーダルAIモデル（テキスト生成、画像生成、音声合成）の統合、リアルタイムコラボレーションとクラウドストレージをサポート。

## お問い合わせ

GitHub：github.com/zeroexo

メール：contact@zeroexo.ai`,
  },
  {
    key: 'changelog',
    title: '最新公告',
    titleEn: 'Latest Announcement',
    titleJa: '最新のお知らせ',
    type: 'announcement',
    content: `## 欢迎使用 ZeroExo AI

感谢您选择 ZeroExo AI 作为您的创意工具。我们正在持续迭代和优化产品功能，为您带来更好的创作体验。

## 近期更新

- 公共提示词库上线：海量精选提示词，支持多语言浏览和收藏
- 智能画布优化：新增节点编辑功能，提升创作效率
- 素材管理升级：支持分类管理和星标收藏

## 即将推出

- 更多 AI 模型接入，提供更丰富的创作选择
- 团队协作功能，支持多人实时编辑
- 移动端适配优化，随时随地创作`,
    contentEn: `## Welcome to ZeroExo AI

Thank you for choosing ZeroExo AI as your creative tool. We are continuously iterating and optimizing our product features to bring you a better creative experience.

## Recent Updates

- Public Prompt Library launched: Curated prompts with multilingual browsing and favorites
- Smart Canvas optimized: New node editing features for improved creative efficiency
- Asset Management upgraded: Category management and star-marked favorites

## Coming Soon

- More AI model integrations for richer creative options
- Team collaboration features for real-time multi-user editing
- Mobile optimization for creation anytime, anywhere`,
    contentJa: `## ZeroExo AIへようこそ

ZeroExo AIをクリエイティブツールとしてお選びいただき、ありがとうございます。私たちは継続的に製品機能を改善し、より良い創作体験を提供しています。

## 最近のアップデート

- 公開プロンプトライブラリ公開：厳選されたプロンプト、多言語対応
- スマートキャンバス最適化：ノード編集機能を追加
- アセット管理アップグレード：カテゴリ管理とスターお気に入り

## 近日公開予定

- より多くのAIモデル統合
- チームコラボレーション機能
- モバイル対応の最適化`,
  },
];

async function main() {
  console.log('正在初始化政策文档数据（版本化）...\n');

  for (const policy of POLICIES) {
    // 先删除旧版 Policy 记录（含级联删除 PolicyVersion）
    const existing = await prisma.policy.findUnique({ where: { key: policy.key } });
    if (existing) {
      // 删除旧版 Policy 和关联的 PolicyVersion（onDelete: Cascade）
      await prisma.policy.delete({ where: { key: policy.key } });
      console.log(`  [删除旧版] ${policy.key}`);
    }

    // 创建新版 Policy（仅 key）
    await prisma.policy.create({
      data: { key: policy.key, currentVersion: 1 },
    });

    // 创建 v1 版本（已发布）
    await prisma.policyVersion.create({
      data: {
        policyKey: policy.key,
        version: 1,
        title: policy.title,
        titleEn: policy.titleEn || '',
        titleJa: policy.titleJa || '',
        content: policy.content,
        contentEn: policy.contentEn || '',
        contentJa: policy.contentJa || '',
        type: policy.type ?? 'policy',
        published: true,
        notes: '初始版本',
        editorId: 'seed',
      },
    });

    console.log(`  [创建] ${policy.key} - ${policy.title} (v1, 已发布)`);
  }

  console.log('\n政策文档数据初始化完成！');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('初始化失败:', e);
  process.exit(1);
});