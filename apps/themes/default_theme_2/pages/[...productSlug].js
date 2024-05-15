import { useEffect, useState }                                                                                            from 'react';
import { ProductJsonLd }                                                                                                  from 'next-seo';
import absoluteUrl                                                                                                        from 'next-absolute-url';
import { useRouter }                                                                                                      from 'next/router';
import getT                                                                                                               from 'next-translate/getT';
import useTranslation                                                                                                     from 'next-translate/useTranslation';
import parse                                                                                                              from 'html-react-parser';
import Cookies                                                                                                            from 'cookies';
import ReactPaginate                                                                                                      from 'react-paginate';
import { Modal }                                                                                                          from 'react-responsive-modal';
import Lightbox                                                                                                           from 'lightbox-react';
import ErrorPage                                                                                                          from '@pages/_error';
import BundleProduct                                                                                                      from '@components/product/BundleProduct';
import ProductVariants                                                                                                    from '@components/product/ProductVariants';
import Layout                                                                                                             from '@components/layouts/Layout';
import NextSeoCustom                                                                                                      from '@components/tools/NextSeoCustom';
import Breadcrumb                                                                                                         from '@components/navigation/Breadcrumb';
import PostReview                                                                                                         from '@components/product/PostReview';
import ProductList                                                                                                        from '@components/product/ProductList';
import BlockCMS                                                                                                           from '@components/common/BlockCMS';
import DrawStars                                                                                                          from '@components/common/DrawStars';
import Button                                                                                                             from '@components/ui/Button';
import { dispatcher }                                                                                                     from '@lib/redux/dispatcher';
import { getBlocksCMS }                                                                                                   from '@aquilacms/aquila-connector/api/blockcms';
import { getBreadcrumb }                                                                                                  from '@aquilacms/aquila-connector/api/breadcrumb';
import { addToCart, deleteCartShipment }                                                                                  from '@aquilacms/aquila-connector/api/cart';
import { getCategories }                                                                                                  from '@aquilacms/aquila-connector/api/category';
import { getProduct, downloadFreeVirtualProduct }                                                                         from '@aquilacms/aquila-connector/api/product';
import { getImage, getMainImage, getTabImageURL }                                                                         from '@aquilacms/aquila-connector/api/product/helpersProduct';
import { generateURLImageCache }                                                                                          from '@aquilacms/aquila-connector/lib/utils';
import { useCart, useAqModules, useProduct, useShowCartSidebar, useSiteConfig, useLoadModules }                           from '@lib/hooks';
import { initAxios, authProtectedPage, formatDate, formatPrice, formatStock, getAvailability, isAllAqModulesInitialised } from '@lib/utils';

import 'lightbox-react/style.css';
import 'react-responsive-modal/styles.css';

export async function getServerSideProps({ defaultLocale, locale, params, query, req, res, resolvedUrl }) {
    initAxios(locale, req, res);
    
    const productSlug   = params.productSlug.pop();
    const categorySlugs = params.productSlug;
    
    if (productSlug.match(/\.[a-z]{2,}$/i)) {
        return { notFound: true };
    }

    let categories = [];
    let product    = {};
    try {
        // Get category from slug
        const dataCategories = await getCategories(locale, { PostBody: { filter: { [`translation.${locale}.slug`]: { $in: categorySlugs } }, limit: 9999 } });
        categories           = dataCategories.datas;

        // Get product from slug
        const postBody = {
            PostBody: {
                filter   : { [`translation.${locale}.slug`]: productSlug },
                structure: { allergens: 1, reviews: 1, set_attributes: 1, trademark: 1, universe: 1 },
                populate : [
                    'allergens',
                    'associated_prds',
                    'bundle_sections.products.id',
                    'set_attributes',
                ]
            }
        };
        product        = await getProduct(postBody, query.preview, locale);
    } catch (err) {
        return { notFound: true };
    }

    if (!product) {
        return { notFound: true };
    }

    // Get URLs for language change
    const slugsLangs    = {};
    const urlsLanguages = [];
    for (const c of categories) {
        for (const [lang, sl] of Object.entries(c.slug)) {
            if (!slugsLangs[lang]) {
                slugsLangs[lang] = [];
            }
            slugsLangs[lang].push(sl);
        }
    }
    
    for (const [lang, sl] of Object.entries(product.slug)) {
        if (slugsLangs[lang]) {
            slugsLangs[lang].push(sl);
        }
    }
    for (const [lang, sl] of Object.entries(slugsLangs)) {
        urlsLanguages.push({ lang, url: `/${sl.join('/')}` });
    }

    // Get cookie server instance
    const cookiesServerInstance = new Cookies(req, res);
    
    // Set cookie product ID
    cookiesServerInstance.set('product', product._id, { path: '/', httpOnly: false, maxAge: 43200000 });

    // Product variants
    if (product.variants_values?.length) {
        const variant            = product.variants_values?.find(vv => vv.default);
        product.active           = variant.active;
        product.images           = variant.images;
        product.name             = variant.name;
        product.stock            = variant.stock;
        product.price            = variant.price;
        product.selected_variant = variant;
    }

    const actions = [
        {
            type : 'SET_PRODUCT',
            value: product
        }, {
            type: 'PUSH_CMSBLOCKS',
            func: getBlocksCMS.bind(this, ['info-bottom-1'], locale)
        }, {
            type : 'SET_URLS_LANGUAGES',
            value: urlsLanguages
        }
    ];

    const pageProps = await dispatcher(locale, req, res, actions);

    // Breadcrumb
    let breadcrumb = [];
    try {
        breadcrumb = await getBreadcrumb(`${defaultLocale !== locale ? `/${locale}` : ''}${resolvedUrl}`);
    } catch (err) {
        const t = await getT(locale, 'common');
        console.error(err.message || t('common:message.unknownError'));
    }
    pageProps.props.breadcrumb = breadcrumb;

    // URL origin
    const { origin }       = absoluteUrl(req);
    pageProps.props.origin = origin;

    return pageProps;
}

const Video = ({ content }) => (
    <iframe
        width="560"
        height="315"
        src={`https://www.youtube.com/embed/${content}`}
        style={{
            maxWidth : '100%',
            position : 'absolute',
            left     : 0,
            right    : 0,
            margin   : 'auto',
            top      : '50%',
            transform: 'translateY(-50%)',
        }}
        title={content}
    />
);

export default function Product({ breadcrumb, origin }) {
    const [qty, setQty]                         = useState(1);
    const [photoIndex, setPhotoIndex]           = useState(0);
    const [reviews, setReviews]                 = useState([]);
    const [filterReviews, setFilterReviews]     = useState({ limit: 5, page: 1, rate: 'all', sort: 'review_date:desc' });
    const [reviewsCount, setReviewsCount]       = useState(0);
    const [isOpen, setIsOpen]                   = useState(false);
    const [message, setMessage]                 = useState();
    const [isLoading, setIsLoading]             = useState(false);
    const [openModal, setOpenModal]             = useState(false);
    const [openModalReview, setOpenModalReview] = useState(false);
    const [tabs, setTabs]                       = useState(0);
    const { aqModules }                         = useAqModules();
    const { cart, setCart }                     = useCart();
    const { product }                           = useProduct();
    const { environment, themeConfig }          = useSiteConfig();
    const { lang, t }                           = useTranslation();
    const { setShowCartSidebar }                = useShowCartSidebar();
    const router                                = useRouter();
    const modulesHooks                          = useLoadModules([
        { id: 'product-tab', props: { product } },
        { id: 'product-bottom', props: { product } },
    ]);

    useEffect(() => {
        // Event when all Aquila modules ("global" type) are initialised
        if (isAllAqModulesInitialised(aqModules)) {
            const addTransaction = new CustomEvent('viewItem', { detail: { product } });
            window.dispatchEvent(addTransaction);
        }
    }, [aqModules]);

    useEffect(() => {
        // Get reviews with filters
        if (product.reviews?.datas.length) {
            let reviews = JSON.parse(JSON.stringify(product.reviews.datas));

            // Sort desc
            if (filterReviews.sort === 'review_date:asc') {
                reviews = reviews.sort((a, b) => new Date(a.review_date) - new Date(b.review_date));
            } else if (filterReviews.sort === 'review_date:desc') {
                reviews = reviews.sort((a, b) => new Date(b.review_date) - new Date(a.review_date));
            } else if (filterReviews.sort === 'rate:asc') {
                reviews = reviews.sort((a, b) => a.rate - b.rate);
            } else if (filterReviews.sort === 'rate:desc') {
                reviews = reviews.sort((a, b) => b.rate - a.rate);
            }

            // Filter by rate
            if (filterReviews.rate !== 'all') {
                reviews = reviews.filter((r) => r.rate === filterReviews.rate);
            }

            setReviewsCount(reviews.length);

            // Filter by page and limit
            reviews = reviews.filter((r, i) => i >= (filterReviews.page - 1) * filterReviews.limit && i < filterReviews.page * filterReviews.limit);

            setReviews(reviews);
        }
    }, [filterReviews]);

    if (!product) return <ErrorPage statusCode={404} />;

    // Getting boolean stock display
    const stockDisplay = themeConfig?.values?.find(t => t.key === 'displayStockProduct')?.value !== undefined ? themeConfig?.values?.find(t => t.key === 'displayStockProduct')?.value : false;
    
    const mainImage   = getMainImage(product.images.filter((i) => !i.content), '578x578', product.selected_variant);
    const images      = getTabImageURL(product.images);
    const tabImageURL = [];
    for (let url of images) {
        tabImageURL.push(origin + url);
    }

    const onChangeQty = (e) => {
        if (!e.target.value) {
            return setQty('');
        } else {
            const quantity = Number(e.target.value);
            if (quantity < 1) {
                return setQty(1);
            }
            setQty(quantity);
        }
    };

    const onAddToCart = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            setMessage();

            // Adding product to cart
            let newCart     = await addToCart(cart._id, product, qty);
            document.cookie = 'cart_id=' + newCart._id + '; path=/;';

            // Deletion of the cart delivery
            if (newCart.delivery?.method) {
                newCart = await deleteCartShipment(newCart._id);
            }

            setCart(newCart);

            // Event
            const addTransaction = new CustomEvent('addToCart', { detail: { product, quantity: qty } });
            window.dispatchEvent(addTransaction);
            
            setShowCartSidebar(true, newCart);
        } catch (err) {
            setMessage({ type: 'error', message: err.message || t('common:message.unknownError') });
        } finally {
            setIsLoading(false);
        }
    };

    const openLightBox = (i) => {
        setPhotoIndex(i);
        setIsOpen(true);
    };

    const previousStep = () => {
        router.back();
    };

    const onOpenModal = (e) => {
        e.preventDefault();
        setOpenModal(true);
    };

    const onCloseModal = () => setOpenModal(false);

    const onOpenModalReview = (e) => {
        e.preventDefault();
        setOpenModalReview(true);
    };

    const onCloseModalReview = () => setOpenModalReview(false);

    const onDownloadVirtualProduct = async (e) => {
        e.preventDefault();
        setIsLoading(true);

        const user = await authProtectedPage(document.cookie);
        if (!user) {
            setMessage({ type: 'error', message: t('common:message.loginRequired') });
            setIsLoading(false);
            return;
        }

        try {
            const res  = await downloadFreeVirtualProduct(product._id);
            const url  = URL.createObjectURL(res.data);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = product.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            setMessage({ type: 'error', message: err.message || t('common:message.unknownError') });
        } finally {
            setIsLoading(false);
        }
    };

    const reviewsPaginate = (page) => {
        setFilterReviews({ ...filterReviews, page: page.selected + 1 });

        // Scroll to reviews
        const element = document.querySelector('.reviews-container');
        if (element) {
            const y = element.getBoundingClientRect().top + window.pageYOffset - 100;
            window.scrollTo({ top: y, behavior: 'smooth' });
        }
    };

    const onFilterReviews = (rate) => {
        setFilterReviews({ ...filterReviews, rate: rate });

        // Scroll to reviews
        const element = document.querySelector('.reviews-container');
        if (element) {
            const y = element.getBoundingClientRect().top + window.pageYOffset - 100;
            window.scrollTo({ top: y, behavior: 'smooth' });
        }
    };

    // Pictos
    const pictos = [];
    if (product.pictos) {
        product.pictos.forEach((picto) => {
            if (pictos.find((p) => p.location === picto.location) !== undefined) {
                pictos.find((p) => p.location === picto.location).pictos.push(picto);
            } else {
                const cardinals = picto.location.split('_');
                const style     = { position: 'absolute', top: 0, left: 0 };
                if (cardinals.includes('RIGHT')) {
                    style.left  = 'inherit';
                    style.right = 0;
                }
                if (cardinals.includes('BOTTOM')) {
                    style.top    = 'inherit';
                    style.bottom = 0;
                }
                if (cardinals.includes('CENTER')) {
                    style.left      = '50%';
                    style.transform = 'translate(-50%, 0)';
                }
                if (cardinals.includes('MIDDLE')) {
                    style.top       = '50%';
                    style.transform = 'translate(0, -50%)';
                }
                pictos.push({ location: picto.location, style, pictos: [picto] });
            }
        });
    }

    const lightboxImages = product.images.sort((a, b) => a.position - b.position).map((item) => {
        if (item.content) return { content: <Video content={item.content} />, alt: item.alt };
        return { content: getImage(item, 'max').url, alt: item.alt };
    });

    const reviewsPageCount = Math.ceil(reviewsCount / filterReviews.limit);

    return (

        <Layout>
            <NextSeoCustom
                title={`${environment?.siteName} - ${product.name}`}
                description={product?.description2?.text}
                canonical={origin + product.canonical}
                lang={lang}
                image={origin + mainImage.url}
            />

            <ProductJsonLd
                productName={product.name}
                images={tabImageURL}
                description={product.description2?.text || ''}
                brand={product.trademark?.name}
                aggregateRating={{
                    ratingValue: product.reviews.average,
                    reviewCount: product.reviews.reviews_nb,
                }}
                offers={[
                    {
                        price        : product.price?.ati?.special ? product.price.ati.special : product.price?.ati.normal,
                        priceCurrency: 'EUR',
                        itemCondition: 'https://schema.org/NewCondition',
                        availability : `https://schema.org/${getAvailability(product.stock)}`,
                        url          : origin + product.canonical
                    }
                ]}
            />

            <div className="header-section product">
                <div className="container-flex-2">
                    <h1 className="header-h1">
                        {product.name}
                    </h1>
                </div>
            </div>

            <Breadcrumb items={breadcrumb} origin={origin} />

            <div className="content-section-short-product">
                <button type="button" className="button bottomspace w-button" onClick={previousStep}>{t('pages/product:return')}</button>
                <div className="container-product">
                    <div className="w-layout-grid product-grid">
                        <div className="product-image-wrapper">
                            {
                                isOpen && (
                                    <Lightbox
                                        mainSrc={lightboxImages[photoIndex].content}
                                        nextSrc={lightboxImages[(photoIndex + 1) % product.images.length].content}
                                        prevSrc={lightboxImages[(photoIndex + product.images.length - 1) % product.images.length].content}
                                        imageTitle={lightboxImages[photoIndex].alt}
                                        onCloseRequest={() => setIsOpen(false)}
                                        onMovePrevRequest={() => setPhotoIndex((photoIndex + product.images.length - 1) % product.images.length)}
                                        onMoveNextRequest={() => setPhotoIndex((photoIndex + 1) % product.images.length)}
                                    />
                                )
                            }
                            <div className="lightbox-link w-inline-block w-lightbox" style={{ position: 'relative', cursor: 'pointer' }}>
                                {
                                    pictos ? pictos.map((picto) => (
                                        <div style={picto.style} key={picto.location + Math.random()}>
                                            {
                                                picto.pictos && picto.pictos.map((p) => <img src={generateURLImageCache('picto', '64x64-70-0,0,0,0', p.pictoId, p.code, p.image)} alt={p.title} title={p.title} key={p._id} />)
                                            }
                                        </div>
                                    )) : ''
                                }
                                <img loading="lazy" src={mainImage.url || '/images/no-image.svg'} alt={mainImage.alt || 'Image produit'} className="product-image" onClick={() => (product.images.length && mainImage.url ? openLightBox(product.images.findIndex((img) => img.default)) : false)} />
                            </div>
                            <div className="collection-list-wrapper w-dyn-list">
                                <div role="list" className="collection-list w-clearfix w-dyn-items">
                                    {product.images?.filter(ou => !ou.default).map((item) => (
                                        <div key={item._id} role="listitem" className="collection-item w-dyn-item" style={{ display: 'flex', alignItems: 'center' }}>
                                            <div className="w-inline-block w-lightbox" style={{ cursor: 'pointer' }} onClick={() => openLightBox(product.images.findIndex((im) => im._id === item._id))}>
                                                {
                                                    item.content ? <img src={`https://img.youtube.com/vi/${item.content}/0.jpg`} alt={item.alt} className="more-image" />
                                                        : <img loading="lazy" src={getImage(item, '75x75').url} alt={item.alt || 'Image produit'} className="more-image" />
                                                }
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="product-content">
                            <h3>{product.name}</h3>
                            { environment.displayingReviews && <div><DrawStars rate={product.reviews.average} displayTextRate={false} width="small" /></div> }
                            <div className="div-block-prix">
                                <div className="price-text">{ product.price.ati.special ? formatPrice(product.price.ati.special) : formatPrice(product.price.ati.normal) }</div>
                                { product.price.ati.special ? <div className="price-text sale">{formatPrice(product.price.ati.normal)}</div> : null }
                            </div>
                            <div className="plain-line" />
                            <div className="full-details w-richtext"><p>{parse(product.description2?.text || '')}</p></div>
                            { product.selected_variant && <ProductVariants /> }
                            <div>
                                <form className="w-commerce-commerceaddtocartform default-state" onSubmit={product.type.startsWith('virtual') && product.price.ati.normal === 0 ? onDownloadVirtualProduct : (product.type.startsWith('bundle') ? onOpenModal : onAddToCart)}>
                                    {
                                        product.active === false || (!product.type.startsWith('virtual') && (product.stock?.status === 'epu' || product.stock?.orderable === false)) ? (
                                            <button type="button" className="w-commerce-commerceaddtocartbutton order-button" disabled={true}>{t('pages/product:unavailable')}</button>
                                        ) : (
                                            <>
                                                <input type="number" min={1} disabled={product.type.startsWith('virtual')} className="w-commerce-commerceaddtocartquantityinput quantity" value={qty} onChange={onChangeQty} onWheel={(e) => e.target.blur()} />
                                                <Button 
                                                    text={product.type.startsWith('virtual') && product.price.ati.normal === 0 ? t('pages/product:download') : (product.type.startsWith('bundle') ? t('pages/product:compose') : t('pages/product:addToBasket'))}
                                                    loadingText={product.type.startsWith('virtual') && product.price.ati.normal === 0 ? t('pages/product:downloading') : t('pages/product:addToCartLoading')}
                                                    isLoading={isLoading}
                                                    className="w-commerce-commerceaddtocartbutton order-button"
                                                />
                                            </>
                                        )
                                    }
                                </form>
                                { stockDisplay && <div style={{ textAlign: 'right' }}>{formatStock(product.stock)}</div> }
                                {
                                    message && (
                                        <div className={`w-commerce-commerce${message.type}`}>
                                            <div>
                                                {message.message}
                                            </div>
                                        </div>
                                    )
                                }
                            </div>
                            <div className="plain-line" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="content-section-bg">
                <div className="container-tight">
                    <div className="w-tabs">
                        <div className="tab-menu w-tab-menu">
                            <a className={`tab-link-round w-inline-block w-tab-link${tabs === 0 ? ' w--current' : ''}`} onClick={() => setTabs(0)}>
                                <div>{t('pages/product:tab1')}</div>
                            </a>
                            <a className={`tab-link-round w-inline-block w-tab-link${tabs === 1 ? ' w--current' : ''}`} onClick={() => setTabs(1)}>
                                <div>{t('pages/product:tab2')}</div>
                            </a>
                            {/* <a className="tab-link-round w-inline-block w-tab-link w--current">
                                <div>Reviews (0)</div>
                            </a> */}
                        </div>
                        <div className="w-tab-content">
                            <div className={`w-tab-pane${tabs === 0 ? ' w--tab-active' : ''}`}>{parse(product.description1?.text || '')}</div>
                            <div className={`w-tab-pane${tabs === 1 ? ' w--tab-active' : ''}`}>
                                <table>
                                    <tbody>
                                        {
                                            product.attributes.sort((a, b) => a.position - b.position).map((attribute) => {
                                                if (!attribute.value) { return; }
                                                if (attribute.type === 'bool') {
                                                    return (
                                                        <tr key={attribute._id}>
                                                            <td style={{ padding: '10px', fontWeight: 'bold' }}>{attribute.name}</td>
                                                            <td style={{ padding: '10px' }}>{t(`pages/product:${attribute.value.toString()}`)}</td>
                                                        </tr>
                                                    );
                                                }
                                                if (attribute.type === 'textfield' || attribute.type === 'textarea') {
                                                    return (
                                                        <tr key={attribute._id}>
                                                            <td style={{ padding: '10px', fontWeight: 'bold' }}>{attribute.name}</td>
                                                            <td style={{ padding: '10px' }}>{parse(attribute.value)}</td>
                                                        </tr>
                                                    );
                                                }
                                                if (attribute.type === 'color') {
                                                    return (
                                                        <tr key={attribute._id}>
                                                            <td style={{ padding: '10px', fontWeight: 'bold' }}>{attribute.name}</td>
                                                            <td style={{ padding: '10px' }}>
                                                                <div style={{
                                                                    width          : '50px',
                                                                    height         : '20px',
                                                                    backgroundColor: attribute.value.toString(),
                                                                    borderRadius   : '5px'
                                                                }}
                                                                />
                                                            </td>
                                                        </tr>
                                                    );
                                                }
                                                if (Array.isArray(attribute.value)) {
                                                    return (
                                                        <tr key={attribute._id}>
                                                            <td style={{ padding: '10px', fontWeight: 'bold' }}>{attribute.name}</td>
                                                            <td style={{ padding: '10px' }}>{parse(attribute.value.join(', '))}</td>
                                                        </tr>
                                                    );
                                                }
                                                return (
                                                    <tr key={attribute._id}>
                                                        <td style={{ padding: '10px', fontWeight: 'bold' }}>{attribute.name}</td>
                                                        <td style={{ padding: '10px' }}>{attribute.value}</td>
                                                    </tr>
                                                );
                                            })
                                        }
                                    </tbody>
                                </table>
                                {modulesHooks['product-tab'] && <hr />}
                                {
                                    modulesHooks['product-tab']
                                }
                            </div>
                            
                        </div>
                    </div>
                </div>
            </div>

            {product.associated_prds?.length > 0 &&
                <div className="content-section-short">
                    <div className="container">
                        <div className="title-wrap-centre">
                            <h3 className="header-h4">{t('pages/product:otherProducts')}</h3>
                        </div>

                        <div className="w-dyn-list">
                            <ProductList type="data" value={product.associated_prds} max={2} />
                        </div>
                    </div>
                </div>
            }

            {
                environment.displayingReviews && (
                    <div className="content-section-short reviews-container">
                        <div className="container">
                            <div className="title-wrap-centre">
                                <h3 className="header-h4">{t('pages/product:reviews')} ({product.reviews.reviews_nb})</h3>
                                { product.reviews.reviews_nb > 0 && <DrawStars rate={product.reviews.average} /> }
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', marginBottom: '10px' }}>
                                {
                                    product.reviews.reviews_nb > 0 && Array.from(Array(5).keys()).map((i) => {
                                        const count = product.reviews.datas.filter((review) => review.rate === i + 1)?.length || 0;
                                        return (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: count ? 'pointer' : 'inherit' }} onClick={() => count && onFilterReviews(i + 1)}>
                                                <DrawStars rate={i + 1} width="small" displayTextRate={false} /> <span style={{ fontSize: '12px' }}>({count})</span>
                                            </div>
                                        );
                                    })
                                }
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px', gap: '10px' }}>
                                <button type="button" className="button w-button" onClick={onOpenModalReview}>{t('pages/product:postReview')}</button>
                                { filterReviews.rate !== 'all' && <button type="button" className="button w-button" onClick={() => setFilterReviews({ ...filterReviews, rate: 'all' })}>{t('pages/product:viewAllReviews')}</button> }
                            </div>
                            {
                                reviews.length > 0 && (
                                    <>
                                        <div style={{ width: '20%' }}>
                                            <select className="select-field w-select" value={filterReviews.sort} onChange={(e) => setFilterReviews({ ...filterReviews, sort: e.target.value })}>
                                                <option value="review_date:asc">{t('pages/product:sortByAscDate')}</option>
                                                <option value="review_date:desc">{t('pages/product:sortByDescDate')}</option>
                                                <option value="rate:asc">{t('pages/product:sortByAscRate')}</option>
                                                <option value="rate:desc">{t('pages/product:sortByDescRate')}</option>
                                            </select>
                                        </div>
                                        <div className="plain-line" />
                                        <div role="list" className="reviews-list w-dyn-items w-row">
                                            {
                                                reviews.map((review) => (
                                                    <div key={review._id} role="listitem" className="menu-item w-dyn-item w-col w-col-12">
                                                        <div className="food-card">
                                                            <div className="food-card-content">
                                                                <h6 className="heading-9">{review.title}</h6>
                                                                <p className="paragraph"><b>{review.name}</b></p>
                                                                <DrawStars rate={review.rate} />
                                                                <p className="paragraph">{review.review}</p>
                                                                <p className="paragraph"><em>{formatDate(review.review_date, lang, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' })}</em></p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            }
                                        </div>
                                        {
                                            reviewsCount > filterReviews.limit && (
                                                <ReactPaginate
                                                    previousLabel={'<'}
                                                    nextLabel={'>'}
                                                    breakLabel={'...'}
                                                    forcePage={filterReviews.page - 1}
                                                    pageCount={reviewsPageCount}
                                                    marginPagesDisplayed={2}
                                                    pageRangeDisplayed={1}
                                                    onPageChange={reviewsPaginate}
                                                    containerClassName={'w-pagination-wrapper pagination'}
                                                    activeClassName={'active'}
                                                />
                                            )
                                        }
                                    </>
                                )
                            }
                        </div>

                        <Modal open={openModalReview} onClose={onCloseModalReview} center classNames={{ modal: 'review-content' }}>
                            <PostReview product={product} onCloseModal={onCloseModalReview} />
                        </Modal>
                    </div>
                )
            }

            { modulesHooks['product-bottom'] }

            <BlockCMS nsCode="info-bottom-1" /> {/* TODO : il faudrait afficher le contenu d'une description de la catégorie rattachée ! */}

            {
                product.type.startsWith('bundle') && (
                    <Modal open={openModal} onClose={onCloseModal} center classNames={{ modal: 'bundle-content' }}>
                        <BundleProduct product={product} qty={qty} onCloseModal={onCloseModal} />
                    </Modal>
                )
            }
        </Layout>
    );
}