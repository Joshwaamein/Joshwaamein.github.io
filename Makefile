PORT ?= 4000
RUBY_IMG := ruby:3.3

.PHONY: serve build clean install

serve:
	@echo "Serving on http://localhost:$(PORT)  (Ctrl-C to stop)"
	@docker run --rm -it -p $(PORT):$(PORT) -v "$(CURDIR)":/work -w /work -e JEKYLL_ENV=development $(RUBY_IMG) sh -c "\
		bundle config set --local path 'vendor/bundle' && \
		bundle install --quiet && \
		bundle exec jekyll serve --host 0.0.0.0 --port $(PORT) --livereload --watch --incremental"

build:
	@docker run --rm -v "$(CURDIR)":/work -w /work -e JEKYLL_ENV=production $(RUBY_IMG) sh -c "\
		bundle config set --local path 'vendor/bundle' && \
		bundle install --quiet && \
		bundle exec jekyll build -d _site"

install:
	@docker run --rm -v "$(CURDIR)":/work -w /work $(RUBY_IMG) sh -c "\
		bundle config set --local path 'vendor/bundle' && \
		bundle install"

clean:
	@rm -rf _site .jekyll-cache .sass-cache vendor
	@echo "Cleaned _site, caches, vendor."
