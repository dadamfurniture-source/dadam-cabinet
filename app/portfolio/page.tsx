'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight, Filter } from 'lucide-react'

const categories = [
  { id: 'all', label: '전체' },
  { id: 'kitchen', label: '주방' },
  { id: 'dressroom', label: '드레스룸' },
  { id: 'living', label: '거실' },
  { id: 'study', label: '서재' },
  { id: 'bedroom', label: '침실' },
  { id: 'builtin', label: '전체 빌트인' },
]

const portfolioItems = [
  {
    id: 1,
    title: '청담동 펜트하우스',
    category: 'kitchen',
    categoryLabel: '주방 & 드레스룸',
    location: '서울 강남구',
    size: '65평',
    color: 'bg-gradient-to-br from-[#D4C5B5] to-[#C4B5A5]',
    description: 'AI 설계를 통한 최적의 수납 공간과 동선을 구현한 프리미엄 펜트하우스 프로젝트',
    tags: ['AI 설계', '주방', '드레스룸'],
    featured: true,
  },
  {
    id: 2,
    title: '한남동 타운하우스',
    category: 'study',
    categoryLabel: '서재 & 수납장',
    location: '서울 용산구',
    size: '85평',
    color: 'bg-gradient-to-br from-[#B8C4C8] to-[#A8B4B8]',
    description: '맞춤형 서재 시스템과 스마트 수납으로 완성한 럭셔리 타운하우스',
    tags: ['AI 설계', '서재', '책장'],
  },
  {
    id: 3,
    title: '성수동 복층 오피스텔',
    category: 'living',
    categoryLabel: '거실장 & 침실',
    location: '서울 성동구',
    size: '32평',
    color: 'bg-gradient-to-br from-[#C8C0B8] to-[#B8B0A8]',
    description: '공간 효율을 극대화한 빌트인 설계로 작은 공간의 가능성을 보여준 프로젝트',
    tags: ['AI 설계', '거실', '복층'],
  },
  {
    id: 4,
    title: '분당 단독주택',
    category: 'builtin',
    categoryLabel: '전체 빌트인',
    location: '경기 성남시',
    size: '120평',
    color: 'bg-gradient-to-br from-[#BCC4C0] to-[#ACB4B0]',
    description: '집 전체를 아우르는 통합 가구 시스템으로 일관된 디자인 언어를 구현',
    tags: ['AI 설계', '전체', '빌트인'],
    featured: true,
  },
  {
    id: 5,
    title: '판교 아파트',
    category: 'dressroom',
    categoryLabel: '드레스룸',
    location: '경기 성남시',
    size: '48평',
    color: 'bg-gradient-to-br from-[#D0C8C0] to-[#C0B8B0]',
    description: 'AI가 제안한 최적의 동선과 수납 공간이 조화를 이룬 모던 드레스룸',
    tags: ['AI 설계', '드레스룸', '수납'],
  },
  {
    id: 6,
    title: '용산 오피스',
    category: 'study',
    categoryLabel: '업무 공간',
    location: '서울 용산구',
    size: '200평',
    color: 'bg-gradient-to-br from-[#A8B0B8] to-[#98A0A8]',
    description: '업무 효율을 극대화하는 맞춤 오피스 가구 시스템',
    tags: ['AI 설계', '오피스', '업무공간'],
  },
  {
    id: 7,
    title: '강남 아파트',
    category: 'kitchen',
    categoryLabel: '주방',
    location: '서울 강남구',
    size: '45평',
    color: 'bg-gradient-to-br from-[#D8D0C8] to-[#C8C0B8]',
    description: '그레이 톤 모던 주방과 아일랜드 수납 시스템',
    tags: ['AI 설계', '주방', '아일랜드'],
  },
  {
    id: 8,
    title: '서초 빌라',
    category: 'living',
    categoryLabel: '거실',
    location: '서울 서초구',
    size: '32평',
    color: 'bg-gradient-to-br from-[#C0C4C8] to-[#B0B4B8]',
    description: '벽면 전체를 활용한 스마트 수납장 시스템',
    tags: ['AI 설계', '거실', '수납'],
  },
  {
    id: 9,
    title: '일산 주상복합',
    category: 'dressroom',
    categoryLabel: '드레스룸',
    location: '경기 고양시',
    size: '50평',
    color: 'bg-gradient-to-br from-[#CCC8C0] to-[#BCB8B0]',
    description: '파우더룸과 연결된 럭셔리 드레스룸 시스템',
    tags: ['AI 설계', '드레스룸', '파우더룸'],
  },
]

export default function PortfolioPage() {
  const [activeCategory, setActiveCategory] = useState('all')

  const filteredItems = activeCategory === 'all'
    ? portfolioItems
    : portfolioItems.filter(item => item.category === activeCategory)

  return (
    <div className="min-h-screen bg-dadam-white">
      {/* Hero Section */}
      <section className="relative py-32 bg-dadam-cream overflow-hidden">
        <div className="absolute inset-0 grid-pattern opacity-50" />
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-dadam-gold/10 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-6 md:px-12">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-dadam-gold/10 border border-dadam-gold/20 mb-6">
              <span className="text-sm font-medium text-dadam-gold">Portfolio</span>
            </div>
            <h1 className="font-serif text-4xl md:text-6xl text-dadam-charcoal">
              AI가 설계하고
              <br />
              <span className="text-dadam-gold">장인이 완성한</span> 작품들
            </h1>
            <p className="mt-6 text-lg text-dadam-gray max-w-2xl">
              다담가구의 AI 설계 시스템과 30년 경력 장인의 손끝에서 탄생한
              프리미엄 맞춤 가구 프로젝트들을 만나보세요.
            </p>
          </div>
        </div>
      </section>

      {/* Filter Section */}
      <section className="sticky top-20 z-30 bg-dadam-white/95 backdrop-blur-md border-b border-dadam-warm">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-4">
          <div className="flex items-center gap-4 overflow-x-auto pb-2">
            <div className="flex items-center gap-2 text-dadam-gray">
              <Filter className="w-4 h-4" />
              <span className="text-sm whitespace-nowrap">필터:</span>
            </div>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-all ${
                  activeCategory === cat.id
                    ? 'bg-dadam-charcoal text-white'
                    : 'bg-dadam-cream text-dadam-charcoal hover:bg-dadam-warm'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery Grid */}
      <section className="section-padding">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredItems.map((item) => (
              <Link
                key={item.id}
                href={`/portfolio/${item.id}`}
                className={`group relative overflow-hidden rounded-2xl card-hover ${
                  item.featured ? 'md:col-span-2' : ''
                }`}
              >
                {/* Image placeholder */}
                <div className={`aspect-[4/3] ${item.color} overflow-hidden`}>
                  <div className="w-full h-full flex items-center justify-center text-dadam-charcoal/50 group-hover:scale-105 transition-transform duration-700">
                    <div className="text-center p-8">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/40 mb-4">
                        <Sparkles className="w-3 h-3" />
                        <span className="text-xs font-medium">AI 설계</span>
                      </div>
                      <p className="font-serif text-2xl">{item.title}</p>
                      <p className="text-sm mt-2">{item.categoryLabel}</p>
                    </div>
                  </div>
                </div>

                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-dadam-black/80 via-dadam-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                  <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-1 bg-white/20 rounded text-xs"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-white/70 mb-2">
                      {item.location} · {item.size}
                    </p>
                    <h3 className="font-serif text-xl mb-2">{item.title}</h3>
                    <p className="text-sm text-white/80 line-clamp-2">{item.description}</p>
                    <div className="flex items-center gap-2 mt-4 text-sm font-medium">
                      <span>자세히 보기</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>

                {/* Info card */}
                <div className="p-6 bg-white border-t border-dadam-warm group-hover:opacity-0 transition-opacity duration-300">
                  <p className="text-xs text-dadam-gray mb-1">{item.location} · {item.size}</p>
                  <h3 className="font-serif text-lg text-dadam-charcoal">{item.title}</h3>
                  <p className="text-sm text-dadam-gold mt-1">{item.categoryLabel}</p>
                </div>
              </Link>
            ))}
          </div>

          {/* Load more */}
          <div className="text-center mt-16">
            <button className="btn-outline">
              더 많은 프로젝트 보기
            </button>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 bg-dadam-cream">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: '850+', label: '완료 프로젝트' },
              { value: '1,200+', label: 'AI 설계 상담' },
              { value: '99.2%', label: '고객 만족도' },
              { value: '30+', label: '장인 경력 (년)' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-4xl md:text-5xl font-serif gradient-text">{stat.value}</p>
                <p className="text-sm text-dadam-gray mt-2">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="section-padding bg-dadam-charcoal text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="font-serif text-3xl md:text-4xl">
            당신의 공간도
            <br />
            <span className="gradient-text">다담가구와 함께</span> 완성하세요
          </h2>
          <p className="mt-6 text-dadam-gray">
            지금 바로 AI 설계 상담을 시작하고,
            당신만의 특별한 가구를 만나보세요.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/ai-design" className="btn-primary">
              <Sparkles className="w-4 h-4 mr-2" />
              AI 설계 상담
            </Link>
            <Link href="/quote" className="btn-outline border-white/30 text-white hover:bg-white hover:text-dadam-charcoal">
              무료 견적 받기
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
